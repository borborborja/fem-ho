import { useEffect, useState } from 'react';
import { t, type components } from '@fem-ho/contracts';
import { v7 as uuidv7 } from 'uuid';
import { api, ApiError } from '../app/api.js';
import { useApi, useMutation } from '../app/useApi.js';
import { useSessionData } from '../app/session.js';
import type { Calendar } from '../app/types.js';

type Attempt = components['schemas']['GoogleCalendarAttempt'];
type Account = components['schemas']['GoogleCalendarAccount'];
type Choice = components['schemas']['GoogleCalendarChoice'];
const root = '/api/v1/calendars/google';

async function loadChoices(path: string, signal: AbortSignal) {
  return { path, calendars: await api.get<Choice[]>(path, signal) };
}

export function GoogleCalendarPanel({ onLinked }: { onLinked: () => void }) {
  const { profile, scopes } = useSessionData();
  const key = `femho.calendar.oauth.${profile.id}`;
  const [attemptId, setAttemptId] = useState(() => localStorage.getItem(key));
  const [attempt, setAttempt] = useState<Attempt>();
  const [checkingFailed, setCheckingFailed] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [choiceId, setChoiceId] = useState('');
  const [writable, setWritable] = useState(true);
  const [scopeIds, setScopeIds] = useState<string[]>([]);
  const availability = useApi<{ enabled: boolean }>(`${root}/oauth`);
  const accounts = useApi<Account[]>(`${root}/accounts`);
  const eligible = (accounts.data ?? []).filter((account) => account.oauth_status === 'connected');
  const active = eligible.find((account) => account.id === accountId) ?? eligible[0];
  const choicePath =
    active === undefined || !availability.data?.enabled
      ? null
      : `${root}/accounts/${active.id}/calendars`;
  const choices = useApi(choicePath, [], loadChoices);
  // Els identificadors tenen sentit dins el compte que ha retornat la llista.
  const calendars = choices.data?.path === choicePath ? choices.data.calendars : undefined;
  const choice = calendars?.find((candidate) => candidate.id === choiceId);
  const owned = scopes.filter((scope) => scope.owner_id === profile.id);

  useEffect(() => {
    if (!attemptId) return;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const result = await api
        .get<Attempt>(`${root}/oauth/attempts/${attemptId}`)
        .catch(() => undefined);
      if (!mounted) return;
      setCheckingFailed(result === undefined);
      setAttempt(result);
      if (result === undefined || result.status === 'pending' || result.status === 'exchanging')
        timer = setTimeout(() => void poll(), result === undefined ? 5000 : 1500);
    };
    void poll();
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [attemptId]);

  const reset = () => {
    localStorage.removeItem(key);
    setAttemptId(null);
    setAttempt(undefined);
    setCheckingFailed(false);
  };
  const authorize = useMutation(async (account?: Account) => {
    const result = await api.post<Attempt & { authorization_url: string }>(`${root}/oauth`, {
      account_id: account?.id,
    });
    localStorage.setItem(key, result.id);
    window.location.assign(result.authorization_url);
  });
  const resolve = useMutation(async (confirm: boolean) => {
    if (!attemptId) return;
    if (confirm) {
      const account = await api.post<Account>(`${root}/oauth/attempts/${attemptId}/confirm`);
      setAccountId(account.id);
    } else {
      try {
        await api.delete(`${root}/oauth/attempts/${attemptId}`);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
      }
    }
    reset();
    accounts.reload();
  });
  const disconnect = useMutation(async (account: Account) => {
    await api.post(`${root}/accounts/${account.id}/disconnect`);
    accounts.reload();
  });
  const link = useMutation(async () => {
    if (active === undefined || choice === undefined) return;
    const outcomes = await Promise.allSettled(
      scopeIds.map((scope) =>
        api.post<Calendar>(`${root}/links`, {
          id: uuidv7(),
          scope_id: scope,
          account_id: active.id,
          remote_calendar_id: choice.id,
          writable: choice.writable && writable,
        }),
      ),
    );
    const pending = scopeIds.filter((_, index) => outcomes[index]?.status === 'rejected');
    setScopeIds(pending);
    onLinked();
    const failed = outcomes.find((outcome) => outcome.status === 'rejected');
    if (failed !== undefined) throw failed.reason;
    setChoiceId('');
  });

  if (!availability.data?.enabled && !attemptId && !(accounts.data?.length ?? 0)) return null;

  return (
    <section data-testid="google-calendar-settings" style={{ display: 'grid', gap: 10 }}>
      <strong>{t('settings.googleCalendar.title')}</strong>
      {attemptId ? (
        <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
          <p role="status" style={{ margin: 0 }}>
            {attempt?.status === 'ready'
              ? t('settings.mail.oauth.confirmEmail', { email: attempt.email ?? '' })
              : checkingFailed || ['failed', 'expired', 'cancelled'].includes(attempt?.status ?? '')
                ? t('settings.googleCalendar.error')
                : t('settings.mail.oauth.pending')}
          </p>
          {attempt?.status === 'ready' ? (
            <button
              type="button"
              className="plou-btn plou-btn-primary"
              disabled={resolve.busy}
              onClick={() => void resolve.run(true)}
            >
              {t('settings.mail.oauth.confirm')}
            </button>
          ) : null}
          <button
            type="button"
            className="plou-btn"
            disabled={resolve.busy}
            onClick={() => void resolve.run(false)}
          >
            {t('nav.cancel')}
          </button>
        </div>
      ) : (
        <>
          {(accounts.data ?? []).map((account) => (
            <div
              key={account.id}
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
            >
              <span>{account.email}</span>
              {account.oauth_status !== 'connected' && availability.data?.enabled ? (
                <button
                  type="button"
                  className="plou-btn"
                  disabled={authorize.busy}
                  onClick={() => void authorize.run(account)}
                >
                  {t('settings.mail.oauth.reconnect')}
                </button>
              ) : null}
              {account.oauth_status === 'connected' ? (
                <button
                  type="button"
                  className="plou-btn plou-btn-ghost"
                  disabled={disconnect.busy}
                  onClick={() => void disconnect.run(account)}
                >
                  {t('settings.mail.oauth.disconnect')}
                </button>
              ) : null}
            </div>
          ))}
          {availability.data?.enabled ? (
            <button
              type="button"
              className="plou-btn"
              disabled={authorize.busy}
              style={{ justifySelf: 'start' }}
              onClick={() => void authorize.run()}
            >
              {t('settings.mail.oauth.connect')}
            </button>
          ) : null}
        </>
      )}
      {active !== undefined && availability.data?.enabled && owned.length > 0 ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <label>
            {t('settings.googleCalendar.account')}
            <select
              className="plou-input"
              value={active.id}
              onChange={(event) => {
                setAccountId(event.target.value);
                setChoiceId('');
              }}
            >
              {eligible.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.email}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('settings.googleCalendar.calendar')}
            <select
              className="plou-input"
              value={choiceId}
              onChange={(event) => {
                setChoiceId(event.target.value);
                setWritable(true);
              }}
            >
              <option value="">{t('settings.googleCalendar.choose')}</option>
              {(calendars ?? []).map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.name}
                </option>
              ))}
            </select>
          </label>
          {choice?.writable ? (
            <label>
              <input
                type="checkbox"
                checked={writable}
                onChange={(event) => setWritable(event.target.checked)}
              />
              {t('settings.googleCalendar.writable')}
            </label>
          ) : choice !== undefined ? (
            <span>{t('settings.googleCalendar.readOnly')}</span>
          ) : null}
          {!choices.loading && calendars?.length === 0 ? (
            <span>{t('settings.googleCalendar.emptyChoices')}</span>
          ) : null}
          {choice !== undefined ? (
            <fieldset style={{ display: 'grid', gap: 5 }}>
              <legend>{t('settings.googleCalendar.scopes')}</legend>
              {owned.map((scope) => (
                <label key={scope.id}>
                  <input
                    type="checkbox"
                    checked={scopeIds.includes(scope.id)}
                    onChange={(event) =>
                      setScopeIds(
                        event.target.checked
                          ? [...scopeIds, scope.id]
                          : scopeIds.filter((id) => id !== scope.id),
                      )
                    }
                  />
                  {scope.name}
                </label>
              ))}
            </fieldset>
          ) : null}
          {choices.error ? (
            <button
              type="button"
              className="plou-btn"
              style={{ justifySelf: 'start' }}
              onClick={choices.reload}
            >
              {t('settings.googleCalendar.reload')}
            </button>
          ) : null}
          <button
            type="button"
            className="plou-btn plou-btn-primary"
            style={{ justifySelf: 'start' }}
            disabled={link.busy || choice === undefined || scopeIds.length === 0}
            onClick={() => void link.run()}
          >
            {t('settings.googleCalendar.link')}
          </button>
        </div>
      ) : null}
      {authorize.error || resolve.error || disconnect.error || link.error ? (
        <p role="alert" style={{ margin: 0, color: 'var(--danger-text)' }}>
          {t('settings.googleCalendar.error')}
        </p>
      ) : null}
    </section>
  );
}
