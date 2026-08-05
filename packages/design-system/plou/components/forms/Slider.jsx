import React from 'react';

export function Slider({ min = 0, max = 100, step = 1, value, onChange, label, valueLabel, style, ...rest }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', width: '100%', ...style }}>
      {label ? (
        <div style={{ fontSize: 'var(--text-tag)', color: 'var(--ink-soft)' }}>
          {label}{valueLabel ? ': ' + valueLabel : ''}
        </div>
      ) : null}
      <input
        type="range"
        className="plou-range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange && onChange(Number(e.target.value))}
        style={{
          WebkitAppearance: 'none', appearance: 'none', width: '100%', height: 4,
          borderRadius: 'var(--radius-bar)', background: 'var(--range-track)', outline: 'none',
        }}
        {...rest}
      />
    </div>
  );
}
