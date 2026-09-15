import { useState, type ReactNode } from 'react';
import { t, type components, type operations } from '@fem-ho/contracts';
import { api, failureText } from '../app/api.js';
import { useApi, useMutation } from '../app/useApi.js';
import { useSessionData } from '../app/session.js';
import type { ApiTokenSummary, Scope } from '../app/types.js';

type Access = components['schemas']['ExternalAccess'];
type TokenInput = NonNullable<
  operations['createApiToken']['requestBody']
>['content']['application/json'];

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
}: {
  scopes: Scope[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset style={{ border: 0, padding: 0, display: 'grid', gap: 8 }}>
      <legend>{t('external.scopes')}</legend>
      <button type="button" className="plou-btn" onClick={() => onChange(scopes.map((s) => s.id))}>
        {t('external.selectAll')}
      </button>
      {scopes.map((scope) => (
        <label key={scope.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
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
      <small>{t('external.futureScopes')}</small>
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
  const [permission, setPermission] = useState<'read_only' | 'read_write'>(
    token?.capabilities.some((c) => c.endsWith(':write')) ? 'read_write' : 'read_only',
  );
  const [deletion, setDeletion] = useState(token?.capabilities.includes('tasks:delete') ?? false);
  const [expiry, setExpiry] = useState(
    token
      ? (token.expires_at?.slice(0, 10) ?? '')
      : new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10),
  );
  const save = useMutation(async () => {
    const preset = agentId
      ? access.presets[permission].filter(
          (c) => !['events:write', 'projects:write', 'attachments:write'].includes(c),
        )
      : access.presets[permission];
    const capabilities = [
      ...preset,
      ...(deletion && channels.includes('api') ? ['tasks:delete', 'events:delete'] : []),
    ];
    const input: TokenInput = {
      name,
      capabilities,
      scope_ids: selected,
      channels: channels as ('api' | 'mcp')[],
      expires_at: expiry ? new Date(`${expiry}T23:59:59Z`).toISOString() : null,
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
            onChange={(e) => setPermission(e.target.value as typeof permission)}
          >
            <option value="read_only">{t('external.readOnly')}</option>
            <option value="read_write">{t('external.readWrite')}</option>
          </select>
        </label>
        <ScopeSelection scopes={scopes} selected={selected} onChange={setSelected} />
        {channels.includes('api') && !agentId && !token?.ai_agent_id ? (
          <details>
            <summary>{t('external.advanced')}</summary>
            <label>
              <input
                type="checkbox"
                checked={deletion}
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
            disabled={save.busy || !name.trim() || selected.length === 0 || channels.length === 0}
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
  await call('list_tasks', { limit: 1 });
  return identity;
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
              {t('external.permission')}:{' '}
              {t(
                verified.capabilities.some((c) => c.endsWith(':write'))
                  ? 'external.readWrite'
                  : 'external.readOnly',
              )}
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
        {(tokens.data?.data ?? []).map((token) => (
          <article
            data-testid={`credential-${token.id}`}
            key={token.id}
            style={{
              display: 'grid',
              gap: 6,
              padding: '12px 0',
              borderBottom: '1px solid var(--card-border)',
            }}
          >
            <strong>{token.name}</strong>
            <span>
              {token.ai_agent_id
                ? t('external.agentCredential')
                : token.credential_type === 'oauth'
                  ? t('external.oauthCredential')
                  : token.token_prefix}
            </span>
            <span>
              {(token.channels ?? ['api', 'mcp']).map((c) => t(`external.${c}`)).join(' · ')} ·{' '}
              {t(
                token.capabilities.some((c) => c.endsWith(':write') || c.endsWith(':delete'))
                  ? 'external.readWrite'
                  : 'external.readOnly',
              )}
            </span>
            <span>
              {token.scope_ids.length
                ? token.scope_ids
                    .map(
                      (id) =>
                        scopes.find((s) => s.id === id)?.name ?? t('external.unavailableScope'),
                    )
                    .join(' · ')
                : t(token.ai_agent_id ? 'external.inheritedScopes' : 'external.emptyScopes')}
            </span>
            <details>
              <summary>{t('external.permissionsDetail')}</summary>
              <p>{token.capabilities.join(' · ')}</p>
            </details>
            <small>
              {t('external.lastUsed', {
                date: token.last_used_at
                  ? new Date(token.last_used_at).toLocaleString()
                  : t('tokens.never'),
              })}{' '}
              ·{' '}
              {t('external.expires', {
                date: token.expires_at
                  ? new Date(token.expires_at).toLocaleDateString()
                  : t('external.never'),
              })}
            </small>
            <span>
              {t(
                token.revoked_at
                  ? 'external.revoked'
                  : token.expires_at && Date.parse(token.expires_at) <= Date.now()
                    ? 'external.expired'
                    : !(token.channels ?? ['api', 'mcp']).some((c) =>
                          c === 'api' ? config.api_enabled : config.mcp_enabled,
                        )
                      ? 'external.paused'
                      : 'external.active',
              )}
            </span>
            {!token.revoked_at ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {token.ai_agent_id ? (
                  <button className="plou-btn" onClick={onGoToAgent}>
                    {t('tokens.aiOwnedGo')}
                  </button>
                ) : token.credential_type !== 'oauth' ? (
                  <button className="plou-btn" onClick={() => setEditing(token)}>
                    {t('external.edit')}
                  </button>
                ) : (
                  <small>{t('external.reconnect')}</small>
                )}
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
          </article>
        ))}
        <button className="plou-btn plou-btn-primary" onClick={() => setEditing('new')}>
          {t('tokens.create')}
        </button>
      </Box>
      {editing ? (
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
  const { scopes } = useSessionData();
  const [selected, setSelected] = useState<string[]>([]);
  const [permission, setPermission] = useState('read_only');
  const [enable, setEnable] = useState(false);
  const submit = useMutation(async (approve: boolean) => {
    if (approve && !access.data?.mcp_enabled && enable)
      await api.patch('/api/v1/external-access', { mcp_enabled: true });
    const result = await api.post<{ redirect_url: string }>(
      `/api/v1/mcp/authorization/${encodeURIComponent(requestId)}`,
      { approve, permission, scope_ids: selected },
    );
    window.location.assign(result.redirect_url);
  });
  return (
    <main style={{ maxWidth: 640, margin: '40px auto', padding: 20 }}>
      <Box>
        <h1>{t('external.authorize')}</h1>
        <ErrorText error={request.error ?? access.error ?? submit.error} />
        {request.data ? (
          <>
            <h2>{request.data.client_name}</h2>
            <p style={{ overflowWrap: 'anywhere' }}>{new URL(request.data.redirect_uri).origin}</p>
            <p>{t('external.consentHelp')}</p>
            <ScopeSelection scopes={scopes} selected={selected} onChange={setSelected} />
            <label>
              {t('external.permission')}
              <select
                className="plou-input"
                aria-label={t('external.permission')}
                value={permission}
                onChange={(e) => setPermission(e.target.value)}
              >
                <option value="read_only">{t('external.readOnly')}</option>
                {request.data.write_requested ? (
                  <option value="read_write">{t('external.readWrite')}</option>
                ) : null}
              </select>
            </label>
            {access.data && !access.data.mcp_enabled ? (
              <label>
                <input
                  type="checkbox"
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
