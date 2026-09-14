import { useEffect, useState } from 'react';
import { t, type components } from '@fem-ho/contracts';
import { v7 as uuidv7 } from 'uuid';
import { api, ApiError } from '../app/api.js';
import { useApi } from '../app/useApi.js';
import { useSessionData } from '../app/session.js';

type Attempt = components['schemas']['MailOAuthAttempt'];
type Account = components['schemas']['MailAccount'];
const knownErrors = new Set([
  'cancelled',
  'expired',
  'missing_scope',
  'missing_refresh_token',
  'identity_mismatch',
  'account_exists',
  'not_configured',
  'reconnect_required',
  'not_ready',
]);
function errorText(code: string): string {
  return t(`settings.mail.oauth.error.${knownErrors.has(code) ? code : 'generic'}`);
}

export function GoogleMailPanel({ accounts, onDone }: { accounts: Account[]; onDone: () => void }) {
  const { profile } = useSessionData();
  const storageKey = `femho.mail.oauth.${profile.id}`;
  const availability = useApi<{ enabled: boolean }>('/api/v1/mail/oauth/google');
  const [target, setTarget] = useState('');
  const [attemptId, setAttemptId] = useState(() => localStorage.getItem(storageKey));
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = accounts.find((a) => a.id === target);

  useEffect(() => {
    if (!attemptId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api.get<Attempt>(`/api/v1/mail/oauth/attempts/${attemptId}`);
        if (!active) return;
        setAttempt(result);
        setError(null);
        if (result.status === 'pending' || result.status === 'exchanging')
          timer = setTimeout(() => void poll(), 2000);
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof ApiError && cause.status === 404
              ? errorText('expired')
              : errorText('generic'),
          );
          if (!(cause instanceof ApiError && [401, 403, 404].includes(cause.status))) {
            timer = setTimeout(() => void poll(), 5000);
          }
        }
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [attemptId]);

  const clear = () => {
    localStorage.removeItem(storageKey);
    setAttemptId(null);
    setAttempt(null);
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(errorText(cause instanceof ApiError ? cause.message : 'generic'));
    } finally {
      setBusy(false);
    }
  };
  if (
    !availability.data?.enabled &&
    !attemptId &&
    !accounts.some((a) => a.auth_method === 'google')
  )
    return null;
  return (
    <section
      data-testid="google-mail"
      style={{ display: 'grid', gap: 12, justifyItems: 'start', fontSize: 14, paddingTop: 16 }}
    >
      <strong>{t('settings.mail.oauth.title')}</strong>
      <p style={{ margin: 0 }}>{t('settings.mail.oauth.help')}</p>
      {attemptId ? (
        <>
          <p role="status">
            {attempt?.status === 'ready'
              ? t('settings.mail.oauth.confirmEmail', { email: attempt.email ?? '' })
              : attempt?.status === 'completed'
                ? t('settings.mail.oauth.connected')
                : attempt?.status === 'failed' ||
                    attempt?.status === 'expired' ||
                    attempt?.status === 'cancelled'
                  ? errorText(attempt.error_code ?? attempt.status)
                  : t('settings.mail.oauth.pending')}
          </p>
          {attempt?.status === 'ready' ? (
            <button
              className="plou-btn plou-btn-primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.post(`/api/v1/mail/oauth/attempts/${attemptId}/confirm`);
                  clear();
                  onDone();
                })
              }
            >
              {t('settings.mail.oauth.confirm')}
            </button>
          ) : null}
          <button
            className="plou-btn"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                try {
                  await api.delete(`/api/v1/mail/oauth/attempts/${attemptId}`);
                } catch (cause) {
                  if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
                }
                clear();
                onDone();
              })
            }
          >
            {t('settings.mail.oauth.cancel')}
          </button>
        </>
      ) : (
        <>
          <label>
            {t('settings.mail.oauth.account')}
            <select
              className="plou-input"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">{t('settings.mail.oauth.new')}</option>
              {accounts
                .filter((a) => ['imap.gmail.com', 'imap.googlemail.com'].includes(a.host))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.username}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="plou-btn plou-btn-primary"
            disabled={busy || !availability.data?.enabled}
            onClick={() =>
              void run(async () => {
                const result = await api.post<Attempt & { authorization_url: string }>(
                  '/api/v1/mail/oauth/google',
                  {
                    account_id: target || uuidv7(),
                    reconnect: target !== '',
                  },
                );
                localStorage.setItem(storageKey, result.id);
                setAttemptId(result.id);
                window.location.assign(result.authorization_url);
              })
            }
          >
            {t(
              selected?.auth_method === 'google'
                ? 'settings.mail.oauth.reconnect'
                : 'settings.mail.oauth.connect',
            )}
          </button>
          {selected?.auth_method === 'google' && selected.oauth_status !== 'disconnected' ? (
            <button
              className="plou-btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.post(`/api/v1/mail/accounts/${selected.id}/oauth/disconnect`);
                  onDone();
                })
              }
            >
              {t('settings.mail.oauth.disconnect')}
            </button>
          ) : null}
        </>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
