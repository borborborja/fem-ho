import React from 'react';

/**
 * ShareDialog — creació i gestió d'un enllaç compartit (docs/04 §6, docs/10 §6).
 *
 * **L'URL es mostra un sol cop i el component ho diu amb totes les lletres.** El token
 * no es pot recuperar del seu HMAC: si l'usuari tanca el diàleg sense copiar-lo, l'ha de
 * tornar a crear. Un avís discret aquí estalvia un enllaç mort.
 *
 * Tot el text arriba per props des del catàleg (regla 3). El component no sap català.
 */
export function ShareDialog({
  open,
  labels,
  permission = 'view',
  onPermissionChange,
  requireName = false,
  onRequireNameChange,
  password = '',
  onPasswordChange,
  expiresAt = '',
  onExpiresAtChange,
  maxViews = '',
  onMaxViewsChange,
  createdUrl,
  onCreate,
  onCopy,
  onClose,
  busy = false,
  error,
  ...rest
}) {
  const titleId = React.useId();
  if (!open) return null;

  const field = (label, control) => (
    <label style={{ display: 'grid', gap: 5 }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-soft)' }}>{label}</span>
      {control}
    </label>
  );

  const inputStyle = {
    font: 'inherit',
    fontSize: 13,
    padding: '9px 12px',
    borderRadius: 'var(--radius-input)',
    border: '1px solid var(--input-border)',
    background: 'var(--input-bg)',
    color: 'var(--ink)',
    width: '100%',
    boxSizing: 'border-box',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="share-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        background: 'var(--scrim)',
      }}
      {...rest}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--card-shadow)',
          padding: '24px 22px',
          display: 'grid',
          gap: 14,
        }}
      >
        <h2 id={titleId} style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--ink)' }}>
          {labels.title}
        </h2>

        {createdUrl === undefined ? (
          <>
            {field(
              labels.permission,
              <select
                value={permission}
                onChange={(event) => onPermissionChange?.(event.target.value)}
                style={inputStyle}
                data-testid="share-permission"
              >
                <option value="view">{labels.permissionView}</option>
                <option value="check">{labels.permissionCheck}</option>
                <option value="comment">{labels.permissionComment}</option>
              </select>,
            )}

            {field(
              labels.password,
              <input
                type="password"
                value={password}
                placeholder={labels.passwordPlaceholder}
                onChange={(event) => onPasswordChange?.(event.target.value)}
                style={inputStyle}
                data-testid="share-password"
              />,
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {field(
                labels.expiresAt,
                <input
                  type="date"
                  value={expiresAt}
                  onChange={(event) => onExpiresAtChange?.(event.target.value)}
                  style={inputStyle}
                  data-testid="share-expires"
                />,
              )}
              {field(
                labels.maxViews,
                <input
                  type="number"
                  min="1"
                  value={maxViews}
                  onChange={(event) => onMaxViewsChange?.(event.target.value)}
                  style={inputStyle}
                  data-testid="share-max-views"
                />,
              )}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5 }}>
              <input
                type="checkbox"
                checked={requireName}
                onChange={(event) => onRequireNameChange?.(event.target.checked)}
                data-testid="share-require-name"
              />
              <span style={{ color: 'var(--ink-soft)' }}>{labels.requireName}</span>
            </label>
          </>
        ) : (
          <div style={{ display: 'grid', gap: 9 }}>
            <input
              readOnly
              value={createdUrl}
              data-testid="share-url"
              onFocus={(event) => event.currentTarget.select()}
              style={{ ...inputStyle, fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}
            />
            {/*
              L'avís no és decoratiu: el token no es pot recuperar del `token_hmac`, i
              qui tanqui el diàleg sense copiar-lo haurà de crear un enllaç nou.
            */}
            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-faint)', lineHeight: 1.4 }}>
              {labels.onceWarning}
            </p>
          </div>
        )}

        {error ? (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--danger-text)' }}>
            {error}
          </p>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
          <button
            type="button"
            onClick={onClose}
            className="plou-btn plou-btn-ghost"
            data-testid="share-close"
          >
            {labels.close}
          </button>
          {createdUrl === undefined ? (
            <button
              type="button"
              onClick={onCreate}
              disabled={busy}
              className="plou-btn plou-btn-primary"
              data-testid="share-create"
            >
              {labels.create}
            </button>
          ) : (
            <button
              type="button"
              onClick={onCopy}
              className="plou-btn plou-btn-primary"
              data-testid="share-copy"
            >
              {labels.copy}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
