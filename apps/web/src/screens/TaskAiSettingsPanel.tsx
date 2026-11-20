import { useState } from 'react';
import { dateTime, getLocale, t } from '@fem-ho/contracts';
import { EmptyState } from '@fem-ho/design-system/femho';
import { api } from '../app/api.js';
import { useSessionData } from '../app/session.js';
import {
  taskAiMethodLabel,
  useTaskAiSettings,
  type TaskAiConnections,
  type TaskAiMethod,
  type TaskAiSetting,
  type TaskAiSettingsInput,
} from '../app/task-ai.js';
import { useToasts } from '../app/toasts.js';
import { useApi, useMutation } from '../app/useApi.js';

const METHODS = ['copy', 'mcp_events', 'claude_routine'] as const;

export function TaskAiSettingsPanel({ onConnect }: { onConnect: () => void }) {
  const { scopes } = useSessionData();
  const settings = useTaskAiSettings();
  if (settings === null) return null;
  if (settings.error && !settings.data) {
    return (
      <div role="alert">
        <p>{t('ai.tasks.loadError')}</p>
        <button className="plou-btn" type="button" onClick={settings.reload}>
          {t('nav.retry')}
        </button>
      </div>
    );
  }
  if (!settings.data) return <p role="status">{t('state.loading')}</p>;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <h2 style={{ margin: 0 }}>{t('settings.tab.aiTasks')}</h2>
      {settings.data.data.length === 0 ? <EmptyState>{t('ai.tasks.empty')}</EmptyState> : null}
      {settings.data.data.map((setting) => {
        const scope = scopes.find((candidate) => candidate.id === setting.scope_id);
        return scope === undefined ? null : (
          <TaskAiScopeForm
            key={scope.id}
            scopeName={scope.name}
            setting={setting}
            reload={settings.reload}
            onConnect={onConnect}
          />
        );
      })}
    </div>
  );
}

function TaskAiScopeForm({
  setting,
  scopeName,
  reload,
  onConnect,
}: {
  setting: TaskAiSetting;
  scopeName: string;
  reload: () => void;
  onConnect: () => void;
}) {
  const [edits, setEdits] = useState<Partial<TaskAiSettingsInput>>({});
  const [lastSaved, setLastSaved] = useState<{
    before: TaskAiSetting;
    after: TaskAiSetting;
  } | null>(null);
  const baseline = lastSaved?.before === setting ? lastSaved.after : setting;
  const enabled = edits.enabled ?? baseline.enabled;
  const method = edits.method ?? baseline.method;
  const options = useApi<TaskAiConnections>(
    enabled && method !== 'copy' && baseline.can_dispatch
      ? `/api/v1/ai/task-settings/${setting.scope_id}/connections`
      : null,
    [method],
  );
  const { notify } = useToasts();
  const save = useMutation(async (input: TaskAiSettingsInput) => {
    const updated = await api.put<TaskAiSetting>(
      `/api/v1/ai/task-settings/${setting.scope_id}`,
      input,
    );
    setLastSaved({ before: setting, after: updated });
    setEdits({});
    reload();
    notify(t('ai.tasks.saved'));
  });
  const edit = (changes: Partial<TaskAiSettingsInput>): void => {
    setEdits((current) => ({ ...current, ...changes }));
  };
  const subscription =
    edits.subscription_id === undefined ? baseline.subscription_id : edits.subscription_id;
  const connection =
    edits.connection_id === undefined ? baseline.connection_id : edits.connection_id;
  const routineId = edits.routine_id === undefined ? baseline.routine_id : edits.routine_id;
  const ready = method === baseline.method && baseline.ready;
  const canDisconnect =
    (method === 'mcp_events' && baseline.subscription_id !== null) ||
    (method === 'claude_routine' &&
      (baseline.connection_id !== null ||
        baseline.routine_id !== null ||
        baseline.has_routine_token));
  const subscribeOptions = options.data?.subscriptions ?? [];
  const connectionOptions = options.data?.connections ?? [];

  return (
    <form
      aria-label={scopeName}
      data-testid={`task-ai-scope-${setting.scope_id}`}
      aria-busy={save.busy}
      onSubmit={(event) => {
        event.preventDefault();
        void save.run({ ...(enabled ? edits : {}), enabled, method });
      }}
      style={{
        display: 'grid',
        gap: 12,
        padding: 16,
        minWidth: 0,
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: 'var(--radius-card)',
      }}
    >
      <h3 style={{ margin: 0 }}>{scopeName}</h3>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          onChange={(event) => edit({ enabled: event.target.checked })}
        />
        {t('ai.tasks.enabled')}
      </label>
      {enabled ? (
        <>
          <label style={{ display: 'grid', gap: 4 }}>
            {t('ai.tasks.method')}
            <select
              className="plou-input"
              value={method}
              onChange={(event) =>
                setEdits({ enabled, method: event.target.value as TaskAiMethod })
              }
            >
              {METHODS.map((value) => (
                <option key={value} value={value}>
                  {taskAiMethodLabel(value)}
                </option>
              ))}
            </select>
          </label>

          {method !== 'copy' && !baseline.can_dispatch ? (
            <p style={{ margin: 0 }}>{t('ai.tasks.noDispatchPermission')}</p>
          ) : null}
          {method !== 'copy' && baseline.can_dispatch ? (
            <>
              {!ready ? (
                <p role="status" style={{ margin: 0 }}>
                  {t('ai.tasks.notReady')}
                </p>
              ) : null}
              <p style={{ margin: 0 }}>
                {t(
                  method === 'mcp_events'
                    ? 'ai.tasks.help.mcpEvents'
                    : 'ai.tasks.help.claudeRoutine',
                )}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="plou-btn plou-btn-ghost" type="button" onClick={onConnect}>
                  {t('settings.tab.mcp')}
                </button>
                <button
                  className="plou-btn plou-btn-ghost"
                  type="button"
                  onClick={() => {
                    options.reload();
                    reload();
                  }}
                >
                  {t('external.reloadConnections')}
                </button>
              </div>
              {options.error ? (
                <p role="alert" style={{ margin: 0, color: 'var(--danger-text)' }}>
                  {t('ai.tasks.loadError')}
                </p>
              ) : null}
              {method === 'mcp_events' ? (
                <>
                  <label style={{ display: 'grid', gap: 4 }}>
                    {t('ai.tasks.scopeId')}
                    <input
                      className="plou-input"
                      value={setting.scope_id}
                      readOnly
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 4 }}>
                    {t('ai.tasks.subscription')}
                    <select
                      className="plou-input"
                      value={subscription ?? ''}
                      disabled={options.loading}
                      onChange={(event) => edit({ subscription_id: event.target.value || null })}
                    >
                      <option value="">{t('ai.tasks.noSelection')}</option>
                      {subscription !== null &&
                      !subscribeOptions.some(({ id }) => id === subscription) ? (
                        <option value={subscription} disabled>
                          {t('ai.tasks.notReady')}
                        </option>
                      ) : null}
                      {subscribeOptions.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.label} · {dateTime(getLocale(), new Date(row.expires_at))}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label style={{ display: 'grid', gap: 4 }}>
                    {t('ai.tasks.connection')}
                    <select
                      className="plou-input"
                      value={connection ?? ''}
                      disabled={options.loading}
                      onChange={(event) => edit({ connection_id: event.target.value || null })}
                    >
                      <option value="">{t('ai.tasks.noSelection')}</option>
                      {connection !== null &&
                      !connectionOptions.some(({ id }) => id === connection) ? (
                        <option value={connection} disabled>
                          {t('ai.tasks.notReady')}
                        </option>
                      ) : null}
                      {connectionOptions.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: 4 }}>
                    {t('ai.tasks.routineId')}
                    <input
                      className="plou-input"
                      autoComplete="off"
                      pattern="trig_[A-Za-z0-9]+"
                      value={routineId ?? ''}
                      onChange={(event) => edit({ routine_id: event.target.value.trim() || null })}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 4 }}>
                    {t('ai.tasks.routineToken')}
                    <input
                      className="plou-input"
                      type="password"
                      autoComplete="new-password"
                      placeholder={
                        baseline.has_routine_token && edits.routine_token !== null
                          ? t('ai.tasks.routineTokenSaved')
                          : undefined
                      }
                      value={edits.routine_token ?? ''}
                      onChange={(event) => {
                        const token = event.target.value.trim();
                        if (token !== '') edit({ routine_token: token });
                        else setEdits(({ routine_token: _removed, ...rest }) => rest);
                      }}
                    />
                  </label>
                  {baseline.has_routine_token && edits.routine_token !== null ? (
                    <button
                      className="plou-btn plou-btn-ghost"
                      type="button"
                      onClick={() => edit({ routine_token: null })}
                      style={{ justifySelf: 'start' }}
                    >
                      {t('ai.tasks.routineTokenRemove')}
                    </button>
                  ) : null}
                </>
              )}
            </>
          ) : null}
        </>
      ) : null}
      {save.error ? (
        <p role="alert" style={{ margin: 0, color: 'var(--danger-text)' }}>
          {t('ai.tasks.saveError')}
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className="plou-btn plou-btn-primary"
          type="submit"
          disabled={Object.keys(edits).length === 0 || save.busy}
        >
          {t('nav.save')}
        </button>
        {enabled && canDisconnect ? (
          <button
            className="plou-btn plou-btn-ghost"
            type="button"
            disabled={save.busy}
            onClick={() =>
              void save.run({
                enabled,
                method,
                ...(method === 'mcp_events'
                  ? { subscription_id: null }
                  : { connection_id: null, routine_id: null, routine_token: null }),
              })
            }
          >
            {t('ai.tasks.disconnect')}
          </button>
        ) : null}
      </div>
    </form>
  );
}
