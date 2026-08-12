/**
 * Login. docs/02 §2.
 *
 * **A la web no hi ha camp de servidor**: el servidor és el que serveix la pàgina. És
 * una diferència deliberada amb Android, que sí que en té perquè l'APK no sap on és la
 * instància fins que l'hi diuen.
 *
 * L'error **mai diu si el correu existeix o no**. Sempre "Correu o contrasenya
 * incorrectes": distingir-los convertiria el formulari en un comprovador de comptes.
 */

import { useState, type FormEvent } from 'react';
import { t } from '@fem-ho/contracts';
import { BrandMark } from '../app/Brand.js';
import { usePublicInfo } from '../app/usePublicInfo.js';
import { useSession } from '../app/session.js';
import { useMutation } from '../app/useApi.js';

export function LoginScreen() {
  const { login } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { run, busy, error } = useMutation(login);

  /**
   * L'enllaç per fer-se un compte **només surt si la instància ho permet**.
   *
   * Ho diu `/info`, que és públic i no demana sessió. Ensenyar-lo sempre portaria a un
   * formulari que respon 403, i una porta pintada que no obre és pitjor que cap porta.
   */
  // Sense `/info` no se sap: es deixa amagat, que és el que no promet res.
  const info = usePublicInfo();
  const open = info?.registration === 'open';

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    void run(email, password);
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        background: 'var(--page-bg)',
      }}
    >
      <form
        onSubmit={onSubmit}
        data-testid="login"
        style={{
          width: '100%',
          maxWidth: 380,
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          boxShadow: 'var(--card-shadow)',
          borderRadius: 'var(--radius-card)',
          padding: '40px 36px',
          display: 'grid',
          gap: 14,
        }}
      >
        {/* El nom de la instància, o el seu logo. Deia «Fem-ho» escrit a mà. */}
        <h1 style={{ margin: 0 }}>
          <BrandMark name={info?.name ?? 'Fem-ho'} logoUrl={info?.logo_url ?? null} size={30} />
        </h1>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-soft)' }}>{t('login.subtitle')}</p>

        <label style={{ display: 'grid', gap: 5 }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-soft)' }}>
            {t('login.email')}
          </span>
          <input
            className="plou-input"
            type="email"
            autoComplete="username"
            value={email}
            data-testid="login-email"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label style={{ display: 'grid', gap: 5 }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-soft)' }}>
            {t('login.password')}
          </span>
          <input
            className="plou-input"
            type="password"
            autoComplete="current-password"
            value={password}
            data-testid="login-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error !== undefined ? (
          <p
            role="alert"
            data-testid="login-error"
            style={{ margin: 0, fontSize: 12, color: 'var(--danger-text)' }}
          >
            {t('login.error')}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          data-testid="login-submit"
          className="plou-btn plou-btn-primary"
          style={{ width: '100%' }}
        >
          {t('login.submit')}
        </button>

        {open ? (
          <a
            href="/register"
            data-testid="login-register"
            style={{
              fontSize: 12.5,
              color: 'var(--brand-ink)',
              textAlign: 'center',
              fontWeight: 600,
            }}
          >
            {t('login.register')}
          </a>
        ) : null}

        <a
          href="/settings"
          style={{ fontSize: 12, color: 'var(--ink-faint)', textAlign: 'center' }}
        >
          {t('login.forgot')}
        </a>
      </form>
    </main>
  );
}
