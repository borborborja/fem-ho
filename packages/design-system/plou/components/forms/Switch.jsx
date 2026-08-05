import React from 'react';

export function Switch({ checked = false, onChange, label, style, ...rest }) {
  const track = (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange && onChange(!checked)}
      style={{
        width: 46, height: 26, flex: 'none', padding: 0, border: 'none', cursor: 'pointer',
        borderRadius: 'var(--radius-pill)', position: 'relative',
        background: checked ? 'var(--gradient-toggle)' : 'var(--track-off)',
        transition: 'background var(--dur-base) var(--ease-standard)',
      }}
      {...rest}
    >
      <span
        style={{
          position: 'absolute', top: 3, left: checked ? 23 : 3, width: 20, height: 20,
          borderRadius: 'var(--radius-circle)', background: '#fff', boxShadow: 'var(--shadow-knob)',
          transition: 'left var(--dur-base) var(--ease-standard)',
        }}
      />
    </button>
  );
  if (!label) return track;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-5)', ...style }}>
      <span style={{ fontSize: 'var(--text-body-xs)' }}>{label}</span>
      {track}
    </div>
  );
}
