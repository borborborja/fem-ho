import { useCallback, useEffect, useRef, useState } from 'react';
import { t, type components } from '@fem-ho/contracts';
import { v7 as uuidv7 } from 'uuid';
import { api, ApiError } from '../app/api.js';
import { useApi, useMutation } from '../app/useApi.js';
import { useSessionData } from '../app/session.js';
import type { Calendar, Scope } from '../app/types.js';

type Attempt = components['schemas']['GoogleCalendarAttempt'];
type Account = components['schemas']['GoogleCalendarAccount'];
type Choice = components['schemas']['GoogleCalendarChoice'];
const root = '/api/v1/calendars/google';

async function loadChoices(path: string, signal: AbortSignal) {
  return { path, calendars: await api.get<Choice[]>(path, signal) };
}

export function useGoogleCalendarSettings() {
  const { profile } = useSessionData();
  const key = `femho.calendar.oauth.${profile.id}`;
  const scopeKey = `${key}.scope`;
  const [attemptId, setAttemptId] = useState(() => localStorage.getItem(key));
  const [resumedScopeId] = useState(() =>
    attemptId === null ? null : localStorage.getItem(scopeKey),
  );
  const [attempt, setAttempt] = useState<Attempt>();
  const [checkingFailed, setCheckingFailed] = useState(false);
  const [preferredAccountId, setPreferredAccountId] = useState<string | null>(null);
  const availability = useApi<{ enabled: boolean }>(`${root}/oauth`);
  const accounts = useApi<Account[]>(`${root}/accounts`);
  const reloadAccounts = accounts.reload;

  const reset = useCallback(() => {
    localStorage.removeItem(key);
    localStorage.removeItem(scopeKey);
    setAttemptId(null);
    setAttempt(undefined);
    setCheckingFailed(false);
  }, [key, scopeKey]);

  useEffect(() => {
    if (!attemptId) return;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const result = await api
        .get<Attempt>(`${root}/oauth/attempts/${attemptId}`)
        .catch(() => undefined);
      if (!mounted) return;
      if (result?.status === 'completed') {
        setPreferredAccountId(result.account_id);
        reset();
        reloadAccounts();
        return;
      }
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
  }, [attemptId, reloadAccounts, reset]);

  const authorize = useMutation(async (account?: Account, scopeId: string | null = null) => {
    const result = await api.post<Attempt & { authorization_url: string }>(`${root}/oauth`, {
      account_id: account?.id,
    });
    localStorage.setItem(key, result.id);
    // El retorn d'OAuth és el mateix per a tots els àmbits i passa per una recàrrega.
    if (scopeId === null) localStorage.removeItem(scopeKey);
    else localStorage.setItem(scopeKey, scopeId);
    window.location.assign(result.authorization_url);
  });

  const resolve = useMutation(async (confirm: boolean) => {
    if (!attemptId) return;
    if (confirm) {
      const account = await api.post<Account>(`${root}/oauth/attempts/${attemptId}/confirm`);
      setPreferredAccountId(account.id);
    } else {
      try {
        await api.delete(`${root}/oauth/attempts/${attemptId}`);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
      }
    }
    reset();
    reloadAccounts();
  });

  const disconnect = useMutation(async (account: Account) => {
    await api.post(`${root}/accounts/${account.id}/disconnect`);
    reloadAccounts();
  });

  return {
    accounts,
    attempt,
    attemptId,
    authorize,
    checkingFailed,
    disconnect,
    enabled: availability.data?.enabled === true,
    loadingAvailability: availability.loading,
    preferredAccountId,
    resolve,
    resumedScopeId,
  };
}

type GoogleCalendarSettings = ReturnType<typeof useGoogleCalendarSettings>;

function GoogleCalendarAuthorization({ google }: { google: GoogleCalendarSettings }) {
  const { attempt, checkingFailed, resolve } = google;

  return (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
      <p role="status" style={{ margin: 0, overflowWrap: 'anywhere' }}>
        {attempt?.status === 'ready'
          ? t('settings.googleCalendar.confirmAccount', { email: attempt.email ?? '' })
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
      {resolve.error ? (
        <p role="alert" style={{ margin: 0, color: 'var(--danger-text)' }}>
          {t('settings.googleCalendar.error')}
        </p>
      ) : null}
    </div>
  );
}

export function GoogleCalendarPanel({
  google,
  showAuthorization,
}: {
  google: GoogleCalendarSettings;
  showAuthorization: boolean;
}) {
  const { accounts, attemptId, authorize, disconnect, enabled } = google;
  if (!enabled && !attemptId && !(accounts.data?.length ?? 0)) return null;
  const canStart = !authorize.busy && attemptId === null;

  return (
    <section data-testid="google-calendar-settings" style={{ display: 'grid', gap: 10 }}>
      <strong>{t('settings.googleCalendar.title')}</strong>
      {attemptId && showAuthorization ? (
        <GoogleCalendarAuthorization google={google} />
      ) : (
        <>
          {(accounts.data ?? []).map((account) => (
            <div
              key={account.id}
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
            >
              <span>{account.email}</span>
              {account.oauth_status !== 'connected' && enabled ? (
                <button
                  type="button"
                  className="plou-btn"
                  disabled={!canStart}
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
          {enabled ? (
            <button
              type="button"
              className="plou-btn"
              disabled={!canStart}
              style={{ justifySelf: 'start' }}
              onClick={() => void authorize.run()}
            >
              {t('settings.mail.oauth.connect')}
            </button>
          ) : null}
        </>
      )}
      {authorize.error || disconnect.error ? (
        <p role="alert" style={{ margin: 0, color: 'var(--danger-text)' }}>
          {t('settings.googleCalendar.error')}
        </p>
      ) : null}
    </section>
  );
}

export function GoogleCalendarSource({
  google,
  scope,
  ownedScopes,
  onLinked,
}: {
  google: GoogleCalendarSettings;
  scope: Scope;
  ownedScopes: Scope[];
  onLinked: () => void;
}) {
  const eligible = (google.accounts.data ?? []).filter(
    (account) => account.oauth_status === 'connected',
  );
  const [accountId, setAccountId] = useState<string>();
  const [selected, setSelected] = useState<{ accountId: string; id: string }>();
  const [writable, setWritable] = useState(true);
  const [scopeIds, setScopeIds] = useState([scope.id]);
  const form = useRef<HTMLDivElement>(null);
  const resumed = google.resumedScopeId === scope.id;
  const pendingAuthorization = resumed && google.attemptId !== null;

  useEffect(() => {
    if (resumed) form.current?.scrollIntoView({ block: 'center' });
  }, [resumed]);

  const active =
    eligible.find((account) => account.id === accountId) ??
    eligible.find((account) => account.id === google.preferredAccountId) ??
    eligible[0];
  const path =
    pendingAuthorization || active === undefined ? null : `${root}/accounts/${active.id}/calendars`;
  const choices = useApi(path, [], loadChoices);
  // La consulta conserva l'última resposta mentre en carrega una altra.
  const calendars = choices.data?.path === path ? choices.data?.calendars : undefined;
  const choice =
    selected?.accountId === active?.id
      ? calendars?.find((calendar) => calendar.id === selected?.id)
      : undefined;
  const destinations = ownedScopes.filter(({ id }) => scopeIds.includes(id));

  const link = useMutation(async () => {
    if (active === undefined || choice === undefined) return;
    const outcomes = await Promise.allSettled(
      destinations.map(({ id }) =>
        api.post<Calendar>(`${root}/links`, {
          id: uuidv7(),
          scope_id: id,
          account_id: active.id,
          remote_calendar_id: choice.id,
          writable: choice.writable && writable,
        }),
      ),
    );
    onLinked();
    const failed = outcomes.find((outcome) => outcome.status === 'rejected');
    if (failed !== undefined) {
      setScopeIds(
        destinations.flatMap(({ id }, index) =>
          outcomes[index]?.status === 'rejected' ? [id] : [],
        ),
      );
      throw failed.reason;
    }
    setSelected(undefined);
    setScopeIds([scope.id]);
  });

  const changeSelection = (next?: { accountId: string; id: string }) => {
    setSelected(next);
    setWritable(true);
    setScopeIds([scope.id]);
    link.reset();
  };

  if (pendingAuthorization) {
    return (
      <div ref={form} data-testid={`google-calendar-source-${scope.id}`}>
        <GoogleCalendarAuthorization google={google} />
      </div>
    );
  }

  return (
    <div
      ref={form}
      data-testid={`google-calendar-source-${scope.id}`}
      style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(0, 1fr)' }}
    >
      {active === undefined ? (
        <>
          {google.accounts.loading ? <span role="status">{t('state.loading')}</span> : null}
          {google.accounts.error ? (
            <button type="button" className="plou-btn" onClick={google.accounts.reload}>
              {t('nav.retry')}
            </button>
          ) : null}
        </>
      ) : (
        <>
          <label>
            {t('settings.googleCalendar.account')}
            <select
              className="plou-input"
              value={active.id}
              disabled={link.busy}
              onChange={(event) => {
                setAccountId(event.target.value);
                changeSelection();
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
              value={choice?.id ?? ''}
              disabled={link.busy || choices.loading}
              onChange={(event) =>
                changeSelection({ accountId: active.id, id: event.target.value })
              }
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
                disabled={link.busy}
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
            <fieldset style={{ display: 'grid', gap: 5, minInlineSize: 0 }} disabled={link.busy}>
              <legend>{t('settings.googleCalendar.scopes')}</legend>
              <label>
                <input type="checkbox" checked={scopeIds.includes(scope.id)} disabled />
                {scope.name}
              </label>
              {ownedScopes
                .filter(({ id }) => id !== scope.id)
                .map((other) => (
                  <label key={other.id}>
                    <input
                      type="checkbox"
                      checked={scopeIds.includes(other.id)}
                      onChange={(event) =>
                        setScopeIds(
                          event.target.checked
                            ? [...scopeIds, other.id]
                            : scopeIds.filter((id) => id !== other.id),
                        )
                      }
                    />
                    {other.name}
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
            disabled={
              link.busy || choices.loading || choice === undefined || destinations.length === 0
            }
            onClick={() => void link.run()}
          >
            {t('settings.googleCalendar.link')}
          </button>
        </>
      )}
      <button
        type="button"
        className="plou-btn"
        style={{ justifySelf: 'start' }}
        disabled={
          google.authorize.busy || google.attemptId !== null || google.accounts.loading || link.busy
        }
        onClick={() => void google.authorize.run(undefined, scope.id)}
      >
        {t(active === undefined ? 'settings.mail.oauth.connect' : 'settings.mail.oauth.new')}
      </button>
      {link.error || choices.error || google.accounts.error || google.authorize.error ? (
        <p role="alert" style={{ margin: 0, color: 'var(--danger-text)' }}>
          {t('settings.googleCalendar.error')}
        </p>
      ) : null}
    </div>
  );
}
