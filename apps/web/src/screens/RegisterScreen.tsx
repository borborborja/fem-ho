/**
 * Fer-se un compte, quan la instància ho permet.
 *
 * És el bessó del login i comparteix la seva regla més important: **l'error mai diu si el
 * correu existeix o no**. Un formulari de registre que respongui "aquest correu ja hi és"
 * és un comprovador de comptes, i el login ja s'aguanta de no dir-ho (`docs/02` §2). El
 * servidor respon igual en els dos casos; aquesta pantalla, doncs, ensenya el mateix.
 *
 * **En acabar ja s'ha entrat.** Registrar-se i tot seguit haver d'escriure el mateix
 * correu i la mateixa contrasenya no aporta res: qui acaba de posar-la ja ha demostrat que
 * la sap.
 */

import { useState, type FormEvent } from 'react';
import { t } from '@fem-ho/contracts';
import { BrandMark } from '../app/Brand.js';
import { usePublicInfo } from '../app/usePublicInfo.js';
import { useSession } from '../app/session.js';
import { useMutation } from '../app/useApi.js';

const CARD = {
  width: '100%',
  maxWidth: 380,
  background: 'var(--card-bg)',
  border: '1px solid var(--card-border)',
  boxShadow: 'var(--card-shadow)',
  borderRadius: 'var(--radius-card)',
  padding: '40px 36px',
  display: 'grid',
  gap: 14,
} as const;

const LABEL = { fontSize: 11.5, fontWeight: 600, color: 'var(--ink-soft)' } as const;

export function RegisterScreen() {
  const { register } = useSession();
  const info = usePublicInfo();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const { run, busy, error } = useMutation(register);

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    void run(email, name, password);
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
      <form onSubmit={onSubmit} data-testid="register" style={CARD}>
        {/* El nom de la instància, o el seu logo. Deia «Fem-ho» escrit a mà. */}
        <h1 style={{ margin: 0 }}>
          <BrandMark name={info?.name ?? 'Fem-ho'} logoUrl={info?.logo_url ?? null} size={30} />
        </h1>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-soft)' }}>
          {t('register.subtitle')}
        </p>

        <label style={{ display: 'grid', gap: 5 }}>
          <span style={LABEL}>{t('login.email')}</span>
          <input
            className="plou-input"
            type="email"
            autoComplete="email"
            value={email}
            data-testid="register-email"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label style={{ display: 'grid', gap: 5 }}>
          <span style={LABEL}>{t('register.name')}</span>
          <input
            className="plou-input"
            autoComplete="nickname"
            value={name}
            data-testid="register-name"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label style={{ display: 'grid', gap: 5 }}>
          <span style={LABEL}>{t('login.password')}</span>
          <input
            className="plou-input"
            type="password"
            autoComplete="new-password"
            value={password}
            data-testid="register-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error !== undefined ? (
          <p
            role="alert"
            data-testid="register-error"
            style={{ margin: 0, fontSize: 12, color: 'var(--danger-text)' }}
          >
            {/*
              El text del problema quan el servidor en dona un —contrasenya curta, correu
              que no ho sembla, registre tancat—, i si no, el genèric. El que no arriba mai
              és "aquest correu ja existeix": això el servidor no ho diu.
            */}
            {error instanceof Error && error.message !== '' ? error.message : t('register.error')}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          data-testid="register-submit"
          className="plou-btn plou-btn-primary"
          style={{ width: '100%' }}
        >
          {t('register.submit')}
        </button>

        <a href="/" style={{ fontSize: 12, color: 'var(--ink-faint)', textAlign: 'center' }}>
          {t('register.haveAccount')}
        </a>
      </form>
    </main>
  );
}
