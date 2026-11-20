import { useEffect, useState } from 'react';
import { t } from '@fem-ho/contracts';
import { api } from '../app/api.js';
import {
  browserDeviceId,
  browserPushBound,
  browserPushSupport,
  devicePath,
  disableBrowserPush,
  enableBrowserPush,
  prepareBrowserPush,
  type BrowserPush,
  type PushDeviceSettings,
  type PushScopeSettings,
  type PushScopeSettingsUpdate,
} from '../app/notification-device.js';
import { useSessionData } from '../app/session.js';
import { useApi, useMutation } from '../app/useApi.js';
import { isConnectionFailure } from '../sync/cache.js';

const choices = {
  task_created: 'notify.activity.taskCreated',
  status_changed: 'notify.activity.statusChanged',
  task_activity: 'notify.activity.taskActivity',
  inbox_entry: 'notify.activity.inboxEntry',
} as const satisfies Record<keyof PushScopeSettingsUpdate, string>;

const panelStyle = {
  minWidth: 0,
  display: 'grid',
  gap: 10,
  padding: 16,
  background: 'var(--card-bg)',
  border: '1px solid var(--card-border)',
  borderRadius: 'var(--radius-card)',
};

export function NotificationSettingsPanel() {
  const { profile } = useSessionData();
  const [id] = useState(() => browserDeviceId(profile.id));
  const path = devicePath(id);
  const query = useApi<PushDeviceSettings>(path);
  const support = browserPushSupport();
  const [prepared, setPrepared] = useState<BrowserPush>();
  const [prepareError, setPrepareError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [bound, setBound] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | undefined>(
    support === 'available' ? Notification.permission : undefined,
  );
  const [saved, setSaved] = useState<PushDeviceSettings>();
  const device = saved ?? query.data;

  useEffect(() => {
    if (support !== 'available') return undefined;
    let current = true;
    const readBrowser = (): void => {
      setPermission(Notification.permission);
      void browserPushBound(id)
        .then((active) => {
          if (current) setBound(active);
        })
        .catch(() => undefined);
    };
    readBrowser();
    setPrepareError(false);
    void prepareBrowserPush()
      .then((push) => {
        if (current) setPrepared(push);
      })
      .catch(() => {
        if (current) setPrepareError(true);
      });
    window.addEventListener('focus', readBrowser);
    return () => {
      current = false;
      window.removeEventListener('focus', readBrowser);
    };
  }, [id, support, retry]);

  const toggle = useMutation(async (enabled: boolean) => {
    if (enabled && prepared !== undefined) {
      try {
        await enableBrowserPush(profile.id, id, prepared);
        setBound(await browserPushBound(id));
      } finally {
        setPermission(Notification.permission);
      }
    } else if (!enabled) {
      setBound(false);
      await disableBrowserPush(id);
    }
    setSaved(await api.get<PushDeviceSettings>(path));
  });

  const patch = useMutation(async (scopeId: string, flags: PushScopeSettingsUpdate) => {
    if (device === undefined) return;
    const apply = (changes: PushScopeSettingsUpdate): PushDeviceSettings => ({
      ...device,
      scopes: device.scopes.map((scope) =>
        scope.scope_id === scopeId ? { ...scope, ...changes } : scope,
      ),
    });
    setSaved(apply(flags));
    try {
      setSaved(apply(await api.patch<PushScopeSettings>(`${path}/scopes/${scopeId}`, flags)));
    } catch (cause) {
      setSaved(device);
      throw cause;
    }
  });
  const busy = toggle.busy || patch.busy;
  const active = device?.enabled === true && device.subscribed && bound && permission === 'granted';
  const error = toggle.error ?? patch.error ?? query.error;

  return (
    <div data-testid="notification-settings" style={{ display: 'grid', gap: 14 }}>
      <h2 style={{ margin: 0 }}>{t('notify.activity.heading')}</h2>
      <div style={panelStyle} aria-busy={busy || query.loading}>
        <p style={{ margin: 0 }}>{t('notify.activity.deviceHelp')}</p>
        {query.loading && <p role="status">{t('notify.activity.loading')}</p>}
        {support === 'ios-install' && <p role="status">{t('notify.activity.iosInstall')}</p>}
        {support === 'unsupported' && <p role="status">{t('notify.activity.unsupported')}</p>}
        {permission === 'denied' && (
          <div role="status">
            <p>{t('notify.activity.permissionDenied')}</p>
            <p>{t('notify.activity.browserPermissionHelp')}</p>
          </div>
        )}
        {support === 'available' && device !== undefined && permission !== 'denied' && (
          <p role="status" style={{ margin: 0 }}>
            {active ? t('notify.activity.subscribed') : t('notify.activity.disabled')}
          </p>
        )}
        {device !== undefined && support === 'available' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {!active && permission !== 'denied' && (
              <button
                type="button"
                className="plou-btn"
                disabled={busy || prepared === undefined}
                onClick={() => void toggle.run(true)}
              >
                {t('notify.activity.enable')}
              </button>
            )}
            {device.enabled && (
              <button
                type="button"
                className="plou-btn plou-btn-ghost"
                disabled={busy}
                onClick={() => void toggle.run(false)}
              >
                {t('notify.activity.disable')}
              </button>
            )}
          </div>
        )}
        {(error || prepareError) && !(toggle.error && permission === 'denied') && (
          <div role="alert">
            <p>
              {error !== undefined && isConnectionFailure(error)
                ? t('notify.activity.needsConnection')
                : prepareError || toggle.error
                  ? t('notify.activity.registrationFailed')
                  : t('notify.activity.saveFailed')}
            </p>
            {(query.error || prepareError) && (
              <button
                type="button"
                className="plou-btn plou-btn-ghost"
                onClick={() => {
                  query.reload();
                  setRetry((value) => value + 1);
                }}
              >
                {t('nav.retry')}
              </button>
            )}
          </div>
        )}
      </div>
      {device?.scopes.map((scope) => {
        const inboxHint = `notify-inbox-${scope.scope_id}`;
        return (
          <fieldset
            key={scope.scope_id}
            data-testid={`notification-scope-${scope.scope_id}`}
            style={panelStyle}
            disabled={!active || busy}
          >
            <legend style={{ paddingInline: 5, fontWeight: 800 }}>{scope.scope_name}</legend>
            {(Object.keys(choices) as (keyof typeof choices)[]).map((choice) => (
              <label key={choice} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  role="switch"
                  checked={scope[choice]}
                  aria-describedby={choice === 'inbox_entry' ? inboxHint : undefined}
                  onChange={(event) =>
                    void patch.run(scope.scope_id, { [choice]: event.target.checked })
                  }
                />
                {t(choices[choice])}
              </label>
            ))}
            <p id={inboxHint} style={{ margin: 0, color: 'var(--ink-soft)', fontSize: 13 }}>
              {t('notify.activity.inboxHint')}
            </p>
          </fieldset>
        );
      })}
    </div>
  );
}
