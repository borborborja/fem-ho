import React from 'react';

const TONES = {
  neutral: { background: 'var(--fab-bg)', color: 'var(--fab-text)', border: 'none' },
  glass: { background: 'var(--glass-fill)', color: 'var(--glass-text)', border: 'none' },
  glassOutlined: { background: 'var(--glass-bg)', color: 'var(--glass-text)', border: '1px solid var(--glass-border)', backdropFilter: 'var(--blur-glass)' },
  gradient: { background: 'var(--gradient-brand-alt)', color: 'var(--on-brand)', border: 'none' },
};

export function IconButton({ tone = 'neutral', size = 38, label, children, style, ...rest }) {
  const [press, setPress] = React.useState(false);
  return (
    <button
      title={label}
      aria-label={label}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      onMouseLeave={() => setPress(false)}
      style={{
        width: size, height: size, flex: 'none',
        borderRadius: 'var(--radius-circle)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', padding: 0,
        transition: 'transform var(--dur-instant) var(--ease-standard)',
        transform: press ? 'scale(var(--press-scale))' : 'none',
        ...TONES[tone], ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
