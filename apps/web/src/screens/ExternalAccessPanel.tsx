import { useState, type ReactNode } from 'react';
import { t, type components, type operations } from '@fem-ho/contracts';
import { api, ApiError, failureText } from '../app/api.js';
import { useApi, useMutation } from '../app/useApi.js';
import { useSessionData } from '../app/session.js';
import type { ApiTokenSummary, Scope } from '../app/types.js';

type Access = components['schemas']['ExternalAccess'];
type TokenInput = NonNullable<
  operations['createApiToken']['requestBody']
>['content']['application/json'];
type TokenUpdate = operations['updateApiToken']['requestBody']['content']['application/json'];
type ConsentInput =
  operations['consentMcpAuthorization']['requestBody']['content']['application/json'];

const TASK_OPERATIONS = [
  ['tasks:read', 'external.operation.read'],
  ['tasks:create', 'external.operation.create'],
  ['tasks:move', 'external.operation.move'],
  ['tasks:update', 'external.operation.update'],
  ['tasks:attach', 'external.operation.attach'],
] as const;

type TaskOperation = (typeof TASK_OPERATIONS)[number][0];
const EXECUTION_OPERATIONS = [
  ['ai_executions:read', 'external.operation.executionRead'],
  ['ai_executions:write', 'external.operation.executionWrite'],
] as const;
type ExecutionOperation = (typeof EXECUTION_OPERATIONS)[number][0];
type Permission = 'read_only' | 'read_write' | 'custom';
const DELETE_CAPABILITIES = ['tasks:delete', 'events:delete'];
const OAUTH_CAPABILITIES: Record<string, string> = {
  'tasks:write': 'external.capability.tasksWrite',
  'events:read': 'external.capability.eventsRead',
  'events:write': 'external.capability.eventsWrite',
  'projects:read': 'external.capability.projectsRead',
  'projects:write': 'external.capability.projectsWrite',
  'scopes:read': 'external.capability.scopesRead',
  'checklists:read': 'external.capability.checklistsRead',
  'checklists:write': 'external.capability.checklistsWrite',
  'comments:read': 'external.capability.commentsRead',
  'comments:write': 'external.capability.commentsWrite',
  'attachments:read': 'external.capability.attachmentsRead',
  'attachments:write': 'external.capability.attachmentsWrite',
};

function capabilityLabel(capability: string): string {
  const key =
    TASK_OPERATIONS.find(([operation]) => operation === capability)?.[1] ??
    EXECUTION_OPERATIONS.find(([operation]) => operation === capability)?.[1] ??
    OAUTH_CAPABILITIES[capability];
  return key ? t(key) : capability;
}

function scopeName(scopes: Scope[], id: string): string {
  return scopes.find((scope) => scope.id === id)?.name ?? t('external.unavailableScope');
}

function operationsOf(capabilities: readonly string[]): TaskOperation[] {
  return TASK_OPERATIONS.map(([operation]) => operation).filter(
    (operation) =>
      capabilities.includes(operation) ||
      (operation === 'tasks:attach'
        ? capabilities.includes('attachments:write')
        : operation !== 'tasks:read' && capabilities.includes('tasks:write')),
  );
}

function permissionSummary(capabilities: string[]): string {
  const labels = TASK_OPERATIONS.filter(([operation]) => capabilities.includes(operation));
  if (labels.length > 0 && capabilities.every((value) => labels.some(([op]) => value === op)))
    return labels.map(([, key]) => t(key)).join(' · ');
  return t(
    capabilities.some(
      (capability) => capability.endsWith(':write') || capability.endsWith(':delete'),
    )
      ? 'external.readWrite'
      : 'external.readOnly',
  );
}

function Box({ children }: { children: ReactNode }) {
  return (
    <section
      style={{
        display: 'grid',
        gap: 14,
        padding: 18,
        border: '1px solid var(--card-border)',
        borderRadius: 'var(--radius-card)',
      }}
    >
      {children}
    </section>
  );
}
function ErrorText({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" style={{ color: 'var(--danger-text)' }}>
      {error instanceof Error ? error.message : failureText(error)}
    </p>
  ) : null;
}
function Copy({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const action = useMutation(async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
  });
  return (
    <>
      <button
        type="button"
        className="plou-btn"
        data-testid="copy-button"
        onClick={() => void action.run()}
      >
        {t(copied ? 'tokens.copied' : 'tokens.copy')}
      </button>
      <ErrorText error={action.error} />
    </>
  );
}

export function ScopeSelection({
  scopes,
  selected,
  onChange,
  allowSelectAll = true,
}: {
  scopes: Pick<Scope, 'id' | 'name'>[];
  selected: string[];
  onChange: (ids: string[]) => void;
  allowSelectAll?: boolean;
}) {
  return (
    <fieldset style={{ border: 0, padding: 0, display: 'grid', gap: 8 }}>
      <legend>{t('external.scopes')}</legend>
      {allowSelectAll ? (
        <button
          type="button"
          className="plou-btn"
          onClick={() => onChange(scopes.map((s) => s.id))}
        >
          {t('external.selectAll')}
        </button>
      ) : null}
      {scopes.map((scope) => (
        <label key={scope.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            data-testid={`credential-scope-${scope.id}`}
            checked={selected.includes(scope.id)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, scope.id]
                  : selected.filter((id) => id !== scope.id),
              )
            }
          />
          {scope.name}
        </label>
      ))}
      {allowSelectAll ? <small>{t('external.futureScopes')}</small> : null}
    </fieldset>
  );
}

function TaskOperationSelection({
  selected,
  onChange,
  canChoose,
}: {
  selected: readonly TaskOperation[];
  onChange: (operations: TaskOperation[]) => void;
  canChoose: (operation: TaskOperation) => boolean;
}) {
  return (
    <fieldset style={{ border: 0, padding: 0, display: 'grid', gap: 8 }}>
      <legend>{t('external.taskOperations')}</legend>
      {TASK_OPERATIONS.filter(([operation]) => canChoose(operation)).map(([operation, label]) => (
        <label key={operation} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            data-testid={`credential-operation-${operation}`}
            checked={selected.includes(operation)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, operation]
                  : selected.filter((item) => item !== operation),
              )
            }
          />
          {t(label)}
        </label>
      ))}
    </fieldset>
  );
}

function TokenEditor({
  access,
  token,
  scopes,
  onSaved,
  onCancel,
  agentId,
}: {
  access: Access;
  token?: ApiTokenSummary;
  scopes: Scope[];
  onSaved: (result: { token?: string }) => void;
  onCancel: () => void;
  agentId?: string;
}) {
  const [name, setName] = useState(token?.name ?? '');
  const [selected, setSelected] = useState<string[]>(token?.scope_ids ?? []);
  const [channels, setChannels] = useState<string[]>(token?.channels ?? ['mcp']);
  const agent = agentId ?? token?.ai_agent_id;
  const presetFor = (mode: 'read_only' | 'read_write') =>
    agent
      ? access.presets[mode].filter(
          (c) => !['events:write', 'projects:write', 'attachments:write'].includes(c),
        )
      : access.presets[mode];
  const before = token?.capabilities.filter((c) => !DELETE_CAPABILITIES.includes(c));
  const [permission, setPermission] = useState<Permission>(() => {
    if (!before) return agent ? 'read_only' : 'custom';
    for (const mode of ['read_only', 'read_write'] as const) {
      const preset = presetFor(mode);
      if (preset.length === before.length && preset.every((c) => before.includes(c))) return mode;
    }
    return 'custom';
  });
  const [selectedOperations, setOperations] = useState<TaskOperation[]>(() =>
    token ? operationsOf(token.capabilities) : ['tasks:read'],
  );
  const [permissionsChanged, setPermissionsChanged] = useState(token === undefined);
  const originalDeletion = token?.capabilities.filter((c) => DELETE_CAPABILITIES.includes(c)) ?? [];
  const [deletion, setDeletion] = useState<boolean | null>(null);
  const [initialExpiry] = useState(() =>
    token
      ? (token.expires_at?.slice(0, 10) ?? '')
      : new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10),
  );
  const [expiry, setExpiry] = useState(initialExpiry);
  const selectedCapabilities =
    permission === 'custom'
      ? selectedOperations.filter((operation) => !agent || operation !== 'tasks:attach')
      : presetFor(permission);
  const deleteCapabilities = deletion && channels.includes('api') ? DELETE_CAPABILITIES : [];
  const capabilities = [
    ...(permissionsChanged ? selectedCapabilities : (before ?? [])),
    ...(deletion === null ? originalDeletion : deleteCapabilities),
  ];
  const save = useMutation(async () => {
    const input: TokenInput = {
      name,
      capabilities,
      scope_ids: selected,
      channels: channels as ('api' | 'mcp')[],
      expires_at:
        token && expiry === initialExpiry
          ? (token.expires_at ?? null)
          : expiry
            ? new Date(`${expiry}T23:59:59Z`).toISOString()
            : null,
    };
    if (token) {
      await api.patch(`/api/v1/tokens/${token.id}`, input);
      onSaved({});
    } else
      onSaved(
        await api.post<{ token: string }>(
          agentId ? `/api/v1/ai/agents/${agentId}/credentials` : '/api/v1/tokens',
          input,
        ),
      );
  });
  return (
    <Box>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save.run();
        }}
        style={{ display: 'grid', gap: 14 }}
      >
        <label>
          {t('tokens.name')}
          <input
            className="plou-input"
            data-testid="token-name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <fieldset>
          <legend>{t('external.channels')}</legend>
          {(['api', 'mcp'] as const).map((channel) => (
            <label key={channel} style={{ marginRight: 16 }}>
              <input
                type="checkbox"
                checked={channels.includes(channel)}
                onChange={(e) =>
                  setChannels(
                    e.target.checked
                      ? [...channels, channel]
                      : channels.filter((c) => c !== channel),
                  )
                }
              />
              {t(`external.${channel}`)}
            </label>
          ))}
        </fieldset>
        <label>
          {t('external.permission')}
          <select
            className="plou-input"
            aria-label={t('external.permission')}
            value={permission}
            onChange={(e) => {
              setPermission(e.target.value as Permission);
              setPermissionsChanged(true);
            }}
          >
            <option value="read_only">{t('external.readOnly')}</option>
            <option value="read_write">{t('external.readWrite')}</option>
            <option value="custom">{t('external.custom')}</option>
          </select>
        </label>
        {permission === 'custom' ? (
          <TaskOperationSelection
            selected={selectedOperations}
            canChoose={(operation) => !agent || operation !== 'tasks:attach'}
            onChange={(operations) => {
              setOperations(operations);
              setPermissionsChanged(true);
            }}
          />
        ) : null}
        <ScopeSelection scopes={scopes} selected={selected} onChange={setSelected} />
        {channels.includes('api') && !agentId && !token?.ai_agent_id ? (
          <details>
            <summary>{t('external.advanced')}</summary>
            <label>
              <input
                type="checkbox"
                checked={deletion ?? originalDeletion.length > 0}
                onChange={(e) => setDeletion(e.target.checked)}
              />
              {t('external.deletePermission')}
            </label>
          </details>
        ) : null}
        <label>
          {t('external.expiry')}
          <input
            type="date"
            className="plou-input"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
          />
          <small>{t('external.noExpiry')}</small>
        </label>
        <ErrorText error={save.error} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="plou-btn plou-btn-primary"
            data-testid="token-create"
            disabled={
              save.busy ||
              !name.trim() ||
              selected.length === 0 ||
              channels.length === 0 ||
              capabilities.length === 0
            }
          >
            {t(token ? 'external.save' : 'tokens.create')}
          </button>
          <button type="button" className="plou-btn" onClick={onCancel}>
            {t('external.cancel')}
          </button>
        </div>
      </form>
    </Box>
  );
}

async function probe(token: string) {
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await fetch('/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    if (!response.ok) throw new Error(t('external.probeFailed', { status: response.status }));
    const text = await response.text();
    const data = text.split('\n').find((line) => line.startsWith('data: '));
    const result = JSON.parse(data ? data.slice(6) : text) as {
      error?: unknown;
      result?: { isError?: boolean; content: { text: string }[] };
    };
    if (result.error || !result.result || result.result.isError)
      throw new Error(t('external.probeFailed', { status: response.status }));
    return JSON.parse(result.result.content[0]!.text) as {
      scope_ids: string[];
      capabilities: string[];
    };
  };
  const identity = await call('whoami', {});
  if (identity.capabilities.includes('tasks:read')) await call('list_tasks', { limit: 1 });
  return identity;
}

function OAuthRestrictionEditor({
  token,
  scopes,
  onDone,
  onCancel,
}: {
  token: ApiTokenSummary;
  scopes: Scope[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const grantedCapabilities = [...new Set(token.capabilities)];
  const grantedScopes = [...new Set(token.scope_ids)];
  const [capabilities, setCapabilities] = useState(grantedCapabilities);
  const [scopeIds, setScopeIds] = useState(grantedScopes);
  const save = useMutation(async () => {
    const input: TokenUpdate = { capabilities, scope_ids: scopeIds };
    await api.patch(`/api/v1/tokens/${token.id}`, input);
    onDone();
  });
  const changed =
    capabilities.length < grantedCapabilities.length || scopeIds.length < grantedScopes.length;
  const stale = save.error instanceof ApiError && save.error.status === 409;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save.run();
      }}
      style={{ display: 'grid', gap: 12 }}
    >
      <p style={{ margin: 0 }}>{t('external.restrictHelp')}</p>
      <fieldset style={{ border: 0, padding: 0, display: 'grid', gap: 8 }}>
        <legend>{t('external.permission')}</legend>
        {grantedCapabilities.map((capability) => (
          <label key={capability} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              data-testid={`oauth-restrict-capability-${capability}`}
              checked={capabilities.includes(capability)}
              onChange={(e) =>
                setCapabilities(
                  e.target.checked
                    ? [...capabilities, capability]
                    : capabilities.filter((item) => item !== capability),
                )
              }
            />
            {capabilityLabel(capability)}
          </label>
        ))}
      </fieldset>
      <ScopeSelection
        scopes={grantedScopes.map((id) => ({ id, name: scopeName(scopes, id) }))}
        selected={scopeIds}
        onChange={setScopeIds}
        allowSelectAll={false}
      />
      <ErrorText error={stale ? t('external.connectionChanged') : save.error} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {stale ? (
          <button type="button" className="plou-btn plou-btn-primary" onClick={onDone}>
            {t('external.reloadConnections')}
          </button>
        ) : (
          <button
            className="plou-btn plou-btn-primary"
            data-testid="oauth-restrict-save"
            disabled={save.busy || !changed || capabilities.length === 0 || scopeIds.length === 0}
          >
            {t('external.save')}
          </button>
        )}
        <button type="button" className="plou-btn" disabled={save.busy} onClick={onCancel}>
          {t('external.cancel')}
        </button>
      </div>
    </form>
  );
}

function credentialStatus(token: ApiTokenSummary, access: Access) {
  if (token.oauth) {
    return token.oauth.status === 'active' && !access.mcp_enabled ? 'paused' : token.oauth.status;
  }
  if (token.revoked_at) return 'revoked';
  if (token.expires_at && Date.parse(token.expires_at) <= Date.now()) return 'expired';
  return (token.channels ?? ['api', 'mcp']).some((channel) => access[`${channel}_enabled`])
    ? 'active'
    : 'paused';
}

export function ExternalAccessPanel({ onGoToAgent }: { onGoToAgent: () => void }) {
  const access = useApi<Access>('/api/v1/external-access');
  const tokens = useApi<{ data: ApiTokenSummary[] }>('/api/v1/tokens');
  const { scopes } = useSessionData();
  const [editing, setEditing] = useState<ApiTokenSummary | 'new' | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [verified, setVerified] = useState<Awaited<ReturnType<typeof probe>> | null>(null);
  const [client, setClient] = useState('chatgpt');
  const update = useMutation(async (key: 'api_enabled' | 'mcp_enabled', enabled: boolean) => {
    await api.patch('/api/v1/external-access', { [key]: enabled });
    access.reload();
  });
  const revoke = useMutation(async (id: string) => {
    await api.delete(`/api/v1/tokens/${id}`);
    tokens.reload();
  });
  const check = useMutation(async () => {
    if (created) {
      setVerified(await probe(created));
      tokens.reload();
    }
  });
  if (!access.data)
    return (
      <>
        <ErrorText error={access.error} />
        <p>{t('state.loading')}</p>
      </>
    );
  const config = access.data;
  const hermes = `mcp_servers:\n  femho:\n    url: ${JSON.stringify(config.mcp_url)}\n    auth: oauth\n    trust: untrusted`;
  const manual = `mcp_servers:\n  femho:\n    url: ${JSON.stringify(config.mcp_url)}\n    headers:\n      Authorization: "Bearer \${FEMHO_MCP_TOKEN}"\n    trust: untrusted`;
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <Box>
        <h2 style={{ margin: 0 }}>{t('settings.tab.mcp')}</h2>
        <p>{t('external.switchHelp')}</p>
        {(['api', 'mcp'] as const).map((channel) => (
          <label key={channel} style={{ display: 'flex', gap: 10 }}>
            <input
              type="checkbox"
              role="switch"
              checked={config[`${channel}_enabled`]}
              disabled={update.busy}
              onChange={(e) => void update.run(`${channel}_enabled`, e.target.checked)}
            />
            {t(`external.${channel}Enabled`)}
          </label>
        ))}
        <ErrorText error={update.error} />
      </Box>
      <Box>
        <h3>{t('external.connect')}</h3>
        <input className="plou-input" data-testid="mcp-url" readOnly value={config.mcp_url} />
        <Copy value={config.mcp_url} />
        <select
          className="plou-input"
          aria-label={t('external.client')}
          value={client}
          onChange={(e) => setClient(e.target.value)}
        >
          {['chatgpt', 'claude', 'hermes'].map((c) => (
            <option key={c} value={c}>
              {t(`external.client.${c}`)}
            </option>
          ))}
        </select>
        <p style={{ whiteSpace: 'pre-line' }}>{t(`external.guide.${client}`)}</p>
        <p>{t('external.oauthPermissions')}</p>
        {client === 'hermes' ? (
          <>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{hermes}</pre>
            <Copy value={hermes} />
            <details>
              <summary>{t('external.manual')}</summary>
              <p>{t('external.envHelp')}</p>
              <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{manual}</pre>
              <Copy value={manual} />
            </details>
          </>
        ) : null}
        <a
          href={
            client === 'chatgpt'
              ? 'https://developers.openai.com/plugins/deploy/connect-chatgpt'
              : client === 'claude'
                ? 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp'
                : 'https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference/'
          }
          target="_blank"
          rel="noreferrer"
        >
          {t('external.documentation')}
        </a>
      </Box>
      {created ? (
        <Box>
          <p>{t('tokens.onceWarning')}</p>
          <input readOnly className="plou-input" data-testid="token-value" value={created} />
          <Copy value={created} />
          <button className="plou-btn" disabled={check.busy} onClick={() => void check.run()}>
            {t('external.check')}
          </button>
          {verified ? (
            <p role="status" data-testid="mcp-verified">
              {t('external.verified')}
              <br />
              {t('external.scopes')}:{' '}
              {verified.scope_ids
                .map((id) => scopes.find((s) => s.id === id)?.name ?? id)
                .join(' · ')}
              <br />
              {t('external.permission')}: {permissionSummary(verified.capabilities)}
            </p>
          ) : null}
          <ErrorText error={check.error} />
          <button className="plou-btn" onClick={() => setCreated(null)}>
            {t('external.closeSecret')}
          </button>
        </Box>
      ) : null}
      <Box>
        <h3>{t('external.credentials')}</h3>
        <ErrorText error={tokens.error ?? revoke.error} />
        {(tokens.data?.data ?? []).map((token) => {
          const oauth = token.credential_type === 'oauth';
          const status = credentialStatus(token, config);
          const canRestrict =
            oauth && (status === 'active' || status === 'paused' || status === 'pending');
          const expiry = oauth ? token.oauth?.expires_at : token.expires_at;
          return (
            <article
              data-testid={`credential-${token.id}`}
              key={token.id}
              style={{
                display: 'grid',
                gap: 6,
                padding: '12px 0',
                borderBottom: '1px solid var(--card-border)',
                overflowWrap: 'anywhere',
              }}
            >
              <strong>{token.name}</strong>
              <span>
                {token.ai_agent_id
                  ? t('external.agentCredential')
                  : oauth
                    ? t('external.oauthCredential')
                    : t('external.manualCredential', { prefix: token.token_prefix })}
              </span>
              <span>
                {(token.channels ?? ['api', 'mcp']).map((c) => t(`external.${c}`)).join(' · ')} ·{' '}
                {permissionSummary(token.capabilities)}
              </span>
              <span>
                {token.scope_ids.length
                  ? token.scope_ids.map((id) => scopeName(scopes, id)).join(' · ')
                  : t(token.ai_agent_id ? 'external.inheritedScopes' : 'external.emptyScopes')}
              </span>
              <details>
                <summary>{t('external.permissionsDetail')}</summary>
                <p>{token.capabilities.map(capabilityLabel).join(' · ')}</p>
              </details>
              <small>
                {t('external.lastUsed', {
                  date: token.last_used_at
                    ? new Date(token.last_used_at).toLocaleString()
                    : t('tokens.never'),
                })}{' '}
                ·{' '}
                {expiry
                  ? t('external.expires', {
                      date: oauth
                        ? new Date(expiry).toLocaleString()
                        : new Date(expiry).toLocaleDateString(),
                    })
                  : t(oauth ? 'external.noConnectionExpiry' : 'external.never')}
              </small>
              <span data-testid={oauth ? `oauth-status-${token.id}` : undefined}>
                {t(`external.${status}`)}
              </span>
              {status !== 'revoked' ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {token.ai_agent_id ? (
                    <button className="plou-btn" onClick={onGoToAgent}>
                      {t('tokens.aiOwnedGo')}
                    </button>
                  ) : !oauth ? (
                    <button className="plou-btn" onClick={() => setEditing(token)}>
                      {t('external.edit')}
                    </button>
                  ) : canRestrict ? (
                    <button
                      className="plou-btn"
                      data-testid={`oauth-restrict-${token.id}`}
                      onClick={() => setEditing(token)}
                    >
                      {t('external.restrict')}
                    </button>
                  ) : null}
                  <button
                    className="plou-btn"
                    data-testid={`token-revoke-${token.id}`}
                    disabled={revoke.busy}
                    onClick={() => void revoke.run(token.id)}
                  >
                    {t('tokens.revoke')}
                  </button>
                </div>
              ) : null}
              {canRestrict && editing && editing !== 'new' && editing.id === token.id ? (
                <OAuthRestrictionEditor
                  token={editing}
                  scopes={scopes}
                  onCancel={() => setEditing(null)}
                  onDone={() => {
                    setEditing(null);
                    tokens.reload();
                  }}
                />
              ) : null}
            </article>
          );
        })}
        <button className="plou-btn plou-btn-primary" onClick={() => setEditing('new')}>
          {t('tokens.create')}
        </button>
      </Box>
      {editing && (editing === 'new' || editing.credential_type !== 'oauth') ? (
        <TokenEditor
          key={typeof editing === 'string' ? editing : editing.id}
          access={config}
          scopes={scopes}
          {...(typeof editing === 'string' ? {} : { token: editing })}
          onCancel={() => setEditing(null)}
          onSaved={(result) => {
            setCreated(result.token ?? null);
            setVerified(null);
            setEditing(null);
            tokens.reload();
          }}
        />
      ) : null}
    </div>
  );
}

export function AgentTokenEditor({
  agentId,
  scopeIds,
  allScopes,
  onSaved,
  onCancel,
}: {
  agentId: string;
  scopeIds: string[];
  allScopes: boolean;
  onSaved: (result: { token?: string }) => void;
  onCancel: () => void;
}) {
  const access = useApi<Access>('/api/v1/external-access');
  const { scopes } = useSessionData();
  return access.data ? (
    <TokenEditor
      access={access.data}
      scopes={scopes.filter((s) => allScopes || scopeIds.includes(s.id))}
      agentId={agentId}
      onSaved={onSaved}
      onCancel={onCancel}
    />
  ) : (
    <ErrorText error={access.error} />
  );
}

export function McpConsentScreen({ requestId }: { requestId: string }) {
  type Request = operations['getMcpAuthorization']['responses'][200]['content']['application/json'];
  const request = useApi<Request>(`/api/v1/mcp/authorization/${encodeURIComponent(requestId)}`);
  const access = useApi<Access>('/api/v1/external-access');
  const { profile, scopes } = useSessionData();
  const account =
    profile.email && profile.email !== profile.name
      ? `${profile.name} (${profile.email})`
      : profile.name;
  const [selected, setSelected] = useState<string[]>([]);
  const [permission, setPermission] = useState<Permission>('custom');
  const [selectedOperations, setOperations] = useState<TaskOperation[]>(() =>
    TASK_OPERATIONS.map(([operation]) => operation),
  );
  const [selectedExecutionOperations, setExecutionOperations] = useState<ExecutionOperation[]>([]);
  const [enable, setEnable] = useState(false);
  const readRequested = request.data?.read_requested !== false;
  const writeRequested = request.data?.write_requested === true;
  const canChoose = (operation: TaskOperation) =>
    operation === 'tasks:read' ? readRequested : writeRequested;
  const canChooseExecution = (operation: ExecutionOperation) =>
    operation === 'ai_executions:read' ? readRequested : writeRequested;
  const capabilities = [
    ...selectedOperations.filter(canChoose),
    ...selectedExecutionOperations.filter(canChooseExecution),
  ];
  const submit = useMutation(async (approve: boolean) => {
    const input: ConsentInput = approve
      ? {
          approve,
          permission,
          scope_ids: selected,
          ...(permission === 'custom' ? { capabilities } : {}),
          ...(!access.data?.mcp_enabled && enable ? { enable_mcp: true } : {}),
        }
      : { approve };
    const result = await api.post<{ redirect_url: string }>(
      `/api/v1/mcp/authorization/${encodeURIComponent(requestId)}`,
      input,
    );
    window.location.assign(result.redirect_url);
  });
  return (
    <main data-testid="mcp-consent" style={{ maxWidth: 640, margin: '40px auto', padding: 20 }}>
      <Box>
        <h1 style={{ margin: 0 }}>{t('external.authorize')}</h1>
        <ErrorText error={request.error ?? access.error ?? submit.error} />
        {request.data ? (
          <>
            <header style={{ display: 'grid', gap: 6, overflowWrap: 'anywhere' }}>
              <h2 style={{ margin: 0 }}>{request.data.client_name}</h2>
              <p data-testid="mcp-consent-account" style={{ margin: 0 }}>
                {t('external.consentAccount', { account })}
              </p>
              <p style={{ margin: 0 }}>
                {t('external.consentDestination', {
                  origin: new URL(request.data.redirect_uri).origin,
                })}
              </p>
            </header>
            <p style={{ margin: 0 }}>{t('external.consentHelp')}</p>
            <ScopeSelection scopes={scopes} selected={selected} onChange={setSelected} />
            {readRequested ? (
              <label>
                {t('external.permission')}
                <select
                  className="plou-input"
                  aria-label={t('external.permission')}
                  value={permission}
                  onChange={(e) => setPermission(e.target.value as Permission)}
                >
                  <option value="read_only">{t('external.readOnly')}</option>
                  {writeRequested ? (
                    <option value="read_write">{t('external.readWrite')}</option>
                  ) : null}
                  <option value="custom">{t('external.custom')}</option>
                </select>
              </label>
            ) : null}
            {permission === 'custom' ? (
              <>
                <TaskOperationSelection
                  selected={selectedOperations.filter(canChoose)}
                  onChange={setOperations}
                  canChoose={canChoose}
                />
                {EXECUTION_OPERATIONS.filter(([operation]) => canChooseExecution(operation)).map(
                  ([operation, label]) => (
                    <label
                      key={operation}
                      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                      <input
                        type="checkbox"
                        data-testid={`credential-operation-${operation}`}
                        checked={selectedExecutionOperations.includes(operation)}
                        onChange={(event) =>
                          setExecutionOperations(
                            event.target.checked
                              ? [...selectedExecutionOperations, operation]
                              : selectedExecutionOperations.filter((value) => value !== operation),
                          )
                        }
                      />
                      {t(label)}
                    </label>
                  ),
                )}
              </>
            ) : access.data ? (
              <p style={{ margin: 0 }}>
                {access.data.presets[permission].map(capabilityLabel).join(' · ')}
              </p>
            ) : null}
            {access.data && !access.data.mcp_enabled ? (
              <label>
                <input
                  type="checkbox"
                  data-testid="mcp-consent-enable"
                  checked={enable}
                  onChange={(e) => setEnable(e.target.checked)}
                />
                {t('external.enableForConsent')}
              </label>
            ) : null}
            <button
              className="plou-btn plou-btn-primary"
              disabled={
                submit.busy ||
                selected.length === 0 ||
                (permission === 'custom' && capabilities.length === 0) ||
                !access.data ||
                (!access.data.mcp_enabled && !enable)
              }
              onClick={() => void submit.run(true)}
            >
              {t('external.allow')}
            </button>
            <button
              className="plou-btn"
              disabled={submit.busy}
              onClick={() => void submit.run(false)}
            >
              {t('external.deny')}
            </button>
          </>
        ) : null}
      </Box>
    </main>
  );
}
