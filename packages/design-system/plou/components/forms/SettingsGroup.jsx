import React from 'react';
import { Card } from '../core/Card.jsx';

// Titled settings card whose rows are separated by hairlines. Each child of
// SettingsGroup.Row is a label + its control, stacked on mobile.
export function SettingsGroup({ title, note, density = 'comfy', children, style, ...rest }) {
  const rows = React.Children.toArray(children);
  return (
    <Card density={density} style={style} {...rest}>
      {title ? <div style={{ fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-subtitle)', marginBottom: note ? 6 : 14 }}>{title}</div> : null}
      {note ? <p style={{ fontSize: 'var(--text-body-xs)', color: 'var(--ink-soft)', margin: '0 0 14px' }}>{note}</p> : null}
      {rows.map((row, i) => (
        <div key={i} style={{ padding: i === 0 ? '0 0 14px' : '14px 0', borderTop: i === 0 ? 'none' : '1px solid var(--divider-soft)', paddingBottom: i === rows.length - 1 ? 0 : 14 }}>
          {row}
        </div>
      ))}
    </Card>
  );
}

export function SettingsRow({ label, children, inline, style, ...rest }) {
  if (inline) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-5)', ...style }} {...rest}>
        <span style={{ fontSize: 'var(--text-body-xs)' }}>{label}</span>
        {children}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', ...style }} {...rest}>
      {label ? <div style={{ fontSize: 'var(--text-body-xs)', color: 'var(--ink-soft)' }}>{label}</div> : null}
      {children}
    </div>
  );
}
