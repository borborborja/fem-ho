import React from 'react';

const BASE = {
  borderRadius: 'var(--radius-pill)',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontWeight: 'var(--weight-bold)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-2)',
  whiteSpace: 'nowrap',
  transition: 'transform var(--dur-instant) var(--ease-standard), filter var(--dur-fast) var(--ease-standard), opacity var(--dur-fast) var(--ease-standard)',
};

const VARIANTS = {
  primary: { background: 'var(--gradient-brand)', color: 'var(--on-brand)', boxShadow: 'var(--shadow-primary)' },
  ghost: { background: 'var(--ghost-bg)', color: 'var(--ghost-text)' },
  danger: { background: 'var(--danger-bg)', color: 'var(--danger-text)' },
  glass: { background: 'var(--glass-fill)', color: 'var(--glass-text)' },
  onAlert: { background: '#fff', color: '#1a2a5c' },
};

const SIZES = {
  sm: { padding: 'var(--pad-btn-sm)', fontSize: 'var(--text-label)' },
  md: { padding: 'var(--pad-btn-mobile)', fontSize: 'var(--text-body-xs)' },
  lg: { padding: 'var(--pad-btn)', fontSize: 'var(--text-body-sm)' },
};

export function Button({
  variant = 'primary', size = 'lg', icon, iconPosition = 'left',
  block, disabled, children, style, ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  return (
    <button
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={{
        ...BASE, ...SIZES[size], ...VARIANTS[variant],
        width: block ? '100%' : undefined,
        flex: block ? '1' : undefined,
        filter: hover && !disabled ? 'brightness(1.04)' : 'none',
        transform: press && !disabled ? 'scale(var(--press-scale))' : 'none',
        opacity: disabled ? 0.45 : 1,
        boxShadow: disabled ? 'none' : VARIANTS[variant].boxShadow,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
      {...rest}
    >
      {icon && iconPosition === 'left' ? icon : null}
      {children}
      {icon && iconPosition === 'right' ? icon : null}
    </button>
  );
}
