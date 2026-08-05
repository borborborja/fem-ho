import React from 'react';

export function SegmentedControl({ options = [], value, onChange, size = 'md', block, style, ...rest }) {
  const pads = { sm: '7px 8px', md: 'var(--pad-seg-opt)', mobile: '9px 10px' };
  const fonts = { sm: '11.5px', md: 'var(--text-body-xs)', mobile: '12.5px' };
  const norm = options.map(o => (typeof o === 'string' ? { value: o, label: o } : o));
  const current = value != null ? value : (norm[0] && norm[0].value);
  return (
    <div
      style={{
        display: 'flex', background: 'var(--seg-bg)', borderRadius: 'var(--radius-pill)',
        padding: size === 'sm' ? '3px' : 'var(--space-1)', gap: 'var(--space-1)',
        width: block ? '100%' : 'fit-content', boxSizing: 'border-box', ...style,
      }}
      role="radiogroup"
      {...rest}
    >
      {norm.map(o => {
        const active = o.value === current;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange && onChange(o.value)}
            style={{
              flex: block ? 1 : 'none', textAlign: 'center', border: 'none', cursor: 'pointer',
              padding: pads[size], fontSize: fonts[size], fontFamily: 'var(--font-sans)',
              borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap',
              transition: 'background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard)',
              background: active ? 'var(--gradient-brand-alt)' : 'transparent',
              color: active ? 'var(--on-brand)' : 'var(--seg-text)',
              fontWeight: active ? 'var(--weight-bold)' : 'var(--weight-medium)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
