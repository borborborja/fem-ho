import React from 'react';

// A wrapping group of pill choices. Plou uses this instead of SegmentedControl
// whenever there are more than four options (colour scales, wind units, base maps):
// the segmented track can't wrap, chips can.
export function ChoiceChips({ options = [], value, onChange, size = 'md', style, ...rest }) {
  const norm = options.map(o => (typeof o === 'string' ? { value: o, label: o } : o));
  const pads = { sm: '7px 13px', md: '9px 16px' };
  const fonts = { sm: 'var(--text-label)', md: 'var(--text-body-xs)' };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--gap-dense)', ...style }} role="radiogroup" {...rest}>
      {norm.map(o => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange && onChange(o.value)}
            style={{
              padding: pads[size], fontSize: fonts[size], fontFamily: 'var(--font-sans)',
              borderRadius: 'var(--radius-pill)', cursor: 'pointer', whiteSpace: 'nowrap',
              transition: 'background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard)',
              border: active ? 'none' : '1px solid var(--card-border)',
              background: active ? 'var(--gradient-brand-alt)' : 'var(--ghost-bg)',
              color: active ? 'var(--on-brand)' : 'var(--ink-soft)',
              fontWeight: active ? 'var(--weight-bold)' : 'var(--weight-medium)',
              boxShadow: active ? 'var(--shadow-primary)' : 'none',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
