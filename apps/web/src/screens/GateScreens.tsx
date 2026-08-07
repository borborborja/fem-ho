/**
 * Les dues portes d'entrada que no són el login: el primer arrencament i la invitació.
 *
 * Totes dues creen una contrasenya i **cap de les dues té sessió** mentre ho fa. Van
 * juntes perquè comparteixen la mateixa forma —targeta centrada, dos camps, un botó— i
 * la mateixa regla: la contrasenya la tria qui la farà servir, no qui convida.
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { negotiate, t } from '@fem-ho/contracts';
import { request } from '../app/api.js';

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
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
      <div
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
        <h1
          style={{
            margin: 0,
            fontSize: 24,
            fontWeight: 900,
            backgroundImage: 'var(--gradient-brand-text)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          {title}
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)' }}>{subtitle}</p>
        {children}
      </div>
    </main>
  );
}

const MIN_PASSWORD = 10;

export function InviteScreen({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    // Es comprova aquí i al servidor. Aquí perquè l'usuari ho sàpiga abans d'enviar-ho;
    // al servidor perquè una comprovació de client no és cap comprovació.
    if (password.length < MIN_PASSWORD) {
      setError(t('invite.tooShort'));
      return;
    }
    if (password !== repeat) {
      setError(t('invite.mismatch'));
      return;
    }

    void request(`/invite/${token}`, { method: 'POST', body: { password } })
      .then(() => {
        setDone(true);
        setError(null);
      })
      .catch(() => {
        // Un token gastat i un d'inexistent responen igual, i aquí també.
        setError(t('share.wrong'));
      });
  };

  if (done) {
    return (
      <Card title={t('invite.title')} subtitle={t('invite.done')}>
        <a href="/" className="plou-btn plou-btn-primary" style={{ textAlign: 'center' }}>
          {t('login.submit')}
        </a>
      </Card>
    );
  }

  return (
    <Card title={t('invite.title')} subtitle={t('invite.subtitle')}>
      <form onSubmit={submit} data-testid="invite" style={{ display: 'grid', gap: 12 }}>
        <input
          className="plou-input"
          type="password"
          autoComplete="new-password"
          data-testid="invite-password"
          value={password}
          placeholder={t('invite.password')}
          onChange={(event) => setPassword(event.target.value)}
        />
        <input
          className="plou-input"
          type="password"
          autoComplete="new-password"
          data-testid="invite-repeat"
          value={repeat}
          placeholder={t('invite.repeat')}
          onChange={(event) => setRepeat(event.target.value)}
        />
        {error !== null ? (
          <p
            role="alert"
            data-testid="invite-error"
            style={{ margin: 0, fontSize: 12, color: 'var(--danger-text)' }}
          >
            {error}
          </p>
        ) : null}
        <button type="submit" className="plou-btn plou-btn-primary" data-testid="invite-submit">
          {t('nav.save')}
        </button>
      </form>
    </Card>
  );
}

export function SetupScreen({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(t('invite.tooShort'));
      return;
    }

    // L'idioma del navegador viatja amb la creació del compte: és l'únic moment en què
    // "automàtic" és inequívoc, perquè encara no hi ha perfil on hagi triat ningú.
    void request('/setup', {
      method: 'POST',
      body: { name, email, password, locale: negotiate(navigator.languages) },
    })
      .then(onDone)
      .catch(() => setError(t('error.generic')));
  };

  return (
    <Card title={t('setup.title')} subtitle={t('setup.subtitle')}>
      <form onSubmit={submit} data-testid="setup" style={{ display: 'grid', gap: 12 }}>
        <input
          className="plou-input"
          data-testid="setup-name"
          value={name}
          placeholder={t('setup.name')}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="plou-input"
          type="email"
          autoComplete="username"
          data-testid="setup-email"
          value={email}
          placeholder={t('login.email')}
          onChange={(event) => setEmail(event.target.value)}
        />
        <input
          className="plou-input"
          type="password"
          autoComplete="new-password"
          data-testid="setup-password"
          value={password}
          placeholder={t('login.password')}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error !== null ? (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--danger-text)' }}>
            {error}
          </p>
        ) : null}
        <button type="submit" className="plou-btn plou-btn-primary" data-testid="setup-submit">
          {t('setup.submit')}
        </button>
      </form>
    </Card>
  );
}
