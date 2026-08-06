/**
 * Ajustos. docs/02 §9.
 *
 * Graella de 220px + contingut, màxim 1100px. Vuit pestanyes: General · Àmbits ·
 * Calendaris · MCP i API · Usuari IA · Compartits · Perfil · Admin.
 *
 * **Dins d'Ajustos no hi ha ni switch de vista ni chips d'àmbit.** El brief hi insisteix
 * (línia 41) i el prototip encara els deixa: aquí la barra superior porta només el
 * wordmark i "‹ Tornar al tauler". Per això aquesta pantalla no munta `TopBar`.
 */

import { useState } from 'react';
import { t } from '@fem-ho/contracts';
import { v7 as uuidv7 } from 'uuid';
import { EmptyState } from '@fem-ho/design-system/femho';
import { api } from '../app/api.js';
import { useRouter } from '../app/router.js';
import { useSession, useSessionData } from '../app/session.js';
import { useApi, useMutation } from '../app/useApi.js';
import type {
  AdminUser,
  Agent,
  ApiTokenSummary,
  Calendar,
  Member,
  ShareSummary,
} from '../app/types.js';
import { ErrorBanner } from './BoardScreen.js';

const TABS = [
  'general',
  'scopes',
  'calendars',
  'mcp',
  'ai',
  'shares',
  'profile',
  'admin',
] as const;
type Tab = (typeof TABS)[number];

export function SettingsScreen() {
  const { profile } = useSessionData();
  const { navigate } = useRouter();
  const [tab, setTab] = useState<Tab>('general');

  // Admin només per a administradors: amagar-la no és seguretat —el servidor ja hi posa
  // `users:manage`— però ensenyar una pestanya que sempre dona 403 és una mala broma.
  const tabs = TABS.filter((key) => key !== 'admin' || profile.role === 'admin');

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 30,
          background: 'var(--sidebar-bg)',
          backdropFilter: 'blur(14px)',
          borderBottom: '1px solid var(--card-border)',
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: '0 auto',
            padding: '12px 28px',
            display: 'flex',
            alignItems: 'center',
            gap: 22,
          }}
        >
          <span
            style={{
              fontSize: 24,
              fontWeight: 900,
              backgroundImage: 'var(--gradient-brand-text)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            Fem-ho
          </span>
          <button
            type="button"
            data-testid="settings-back"
            onClick={() => navigate('/')}
            style={{
              border: 'none',
              background: 'transparent',
              font: 'inherit',
              fontSize: 13,
              cursor: 'pointer',
              color: 'var(--ink-soft)',
            }}
          >
            {t('nav.backToBoard')}
          </button>
        </div>
      </header>

      <div
        data-testid="settings-screen"
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '24px 28px',
          display: 'grid',
          gridTemplateColumns: '220px 1fr',
          gap: 28,
          alignItems: 'start',
        }}
      >
        <nav style={{ display: 'grid', gap: 2 }}>
          {tabs.map((key) => (
            <button
              key={key}
              type="button"
              data-testid={`settings-tab-${key}`}
              aria-current={tab === key}
              onClick={() => setTab(key)}
              style={{
                textAlign: 'left',
                padding: '9px 12px',
                borderRadius: 10,
                border: 'none',
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 13,
                fontWeight: tab === key ? 700 : 500,
                background: tab === key ? 'var(--ghost-bg)' : 'transparent',
                color: 'var(--ink)',
              }}
            >
              {t(`settings.tab.${key}`)}
            </button>
          ))}
        </nav>

        <section>
          {tab === 'general' ? <GeneralTab /> : null}
          {tab === 'scopes' ? <ScopesTab /> : null}
          {tab === 'calendars' ? <CalendarsTab /> : null}
          {tab === 'mcp' ? <McpTab /> : null}
          {tab === 'ai' ? <AiTab /> : null}
          {tab === 'shares' ? <SharesTab /> : null}
          {tab === 'profile' ? <ProfileTab /> : null}
          {tab === 'admin' ? <AdminTab /> : null}
        </section>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: 'var(--radius-card)',
        padding: 18,
        marginBottom: 16,
        display: 'grid',
        gap: 12,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>{title}</h2>
      {children}
    </section>
  );
}

function Chips<T extends string>({
  value,
  options,
  onChange,
  testId,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (next: T) => void;
  testId: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-testid={testId}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          data-testid={`${testId}-${option.key}`}
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
          style={{
            padding: '7px 14px',
            borderRadius: 100,
            cursor: 'pointer',
            font: 'inherit',
            fontSize: 12,
            fontWeight: value === option.key ? 700 : 500,
            border: '1px solid var(--card-border)',
            background: value === option.key ? 'var(--ghost-bg)' : 'transparent',
            color: 'var(--ink)',
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  testId,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  testId: string;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5 }}>
      <input
        type="checkbox"
        checked={checked}
        data-testid={testId}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span style={{ color: 'var(--ink-soft)' }}>{label}</span>
    </label>
  );
}

function GeneralTab() {
  const { profile, settings } = useSessionData();
  const { updateProfile, updateSettings } = useSession();

  return (
    <>
      <Group title={t('settings.theme')}>
        <Chips
          testId="theme-chips"
          value={profile.theme}
          options={[
            { key: 'system' as const, label: t('settings.theme.system') },
            { key: 'light' as const, label: t('settings.theme.light') },
            { key: 'dark' as const, label: t('settings.theme.dark') },
          ]}
          onChange={(theme) => void updateProfile({ theme })}
        />
      </Group>

      <Group title={t('settings.accent')}>
        <Chips
          testId="accent-chips"
          value={profile.accent}
          options={[
            { key: 'default' as const, label: t('settings.accent.default') },
            { key: 'soft' as const, label: t('settings.accent.soft') },
            { key: 'mono-warm' as const, label: t('settings.accent.mono-warm') },
            { key: 'mono-cool' as const, label: t('settings.accent.mono-cool') },
          ]}
          onChange={(accent) => void updateProfile({ accent })}
        />
      </Group>

      <Group title={t('settings.dashboardItems')}>
        <Toggle
          testId="toggle-calendar-widget"
          label={t('settings.showCalendarWidget')}
          checked={settings.show_calendar_widget !== false}
          onChange={(value) => void updateSettings({ show_calendar_widget: value })}
        />
        <Toggle
          testId="toggle-overdue-section"
          label={t('settings.showOverdueSection')}
          checked={settings.show_overdue_section !== false}
          onChange={(value) => void updateSettings({ show_overdue_section: value })}
        />
      </Group>

      <Group title={t('settings.inboxPosition')}>
        <Chips
          testId="inbox-position"
          value={settings.inbox_position ?? 'right'}
          options={[
            { key: 'left' as const, label: t('settings.inbox.left') },
            { key: 'right' as const, label: t('settings.inbox.right') },
            { key: 'below' as const, label: t('settings.inbox.below') },
          ]}
          onChange={(position) => void updateSettings({ inbox_position: position })}
        />
        <Toggle
          testId="toggle-inbox-overdue"
          label={t('settings.inboxShowOverdue')}
          checked={settings.inbox_show_overdue !== false}
          onChange={(value) => void updateSettings({ inbox_show_overdue: value })}
        />
      </Group>
    </>
  );
}

function ScopesTab() {
  const { scopes } = useSessionData();
  const { reload } = useSession();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'individual' | 'collective'>('individual');
  const [openScope, setOpenScope] = useState<string | null>(null);

  const create = useMutation(async () => {
    if (name.trim() === '') return;
    await api.post('/api/v1/scopes', {
      id: uuidv7(),
      name: name.trim(),
      kind,
      color: '--plou-blue',
    });
    setName('');
    await reload();
  });

  return (
    <>
      <Group title={t('settings.tab.scopes')}>
        {scopes.map((scope) => (
          <div key={scope.id} style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: `var(${scope.color})`,
                }}
              />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{scope.name}</span>
              <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
                {t(`settings.scopeKind.${scope.kind}`)}
              </span>
              {scope.kind === 'collective' ? (
                <button
                  type="button"
                  data-testid={`scope-members-${scope.id}`}
                  onClick={() => setOpenScope(openScope === scope.id ? null : scope.id)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    font: 'inherit',
                    fontSize: 12,
                    cursor: 'pointer',
                    color: 'var(--ink-soft)',
                  }}
                >
                  {t('settings.members')}
                </button>
              ) : null}
            </div>
            {openScope === scope.id ? <MembersList scopeId={scope.id} /> : null}
          </div>
        ))}
      </Group>

      <Group title={t('settings.newScope')}>
        <input
          className="plou-input"
          data-testid="new-scope-name"
          value={name}
          placeholder={t('settings.scopeName')}
          onChange={(event) => setName(event.target.value)}
        />
        <Chips
          testId="new-scope-kind"
          value={kind}
          options={[
            { key: 'individual' as const, label: t('settings.scopeKind.individual') },
            { key: 'collective' as const, label: t('settings.scopeKind.collective') },
          ]}
          onChange={setKind}
        />
        <button
          type="button"
          className="plou-btn plou-btn-primary"
          data-testid="new-scope-create"
          disabled={create.busy}
          onClick={() => void create.run()}
        >
          {t('nav.create')}
        </button>
      </Group>
    </>
  );
}

function MembersList({ scopeId }: { scopeId: string }) {
  const members = useApi<Member[]>(`/api/v1/scopes/${scopeId}/members`);
  return (
    <div style={{ paddingLeft: 18, display: 'grid', gap: 5 }}>
      {(members.data ?? []).map((member) => (
        <div key={member.id} style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
          {member.name ?? member.user_id ?? ''} · {t(`settings.role.${member.role}`)}
        </div>
      ))}
    </div>
  );
}

function CalendarsTab() {
  const { scopes } = useSessionData();
  const calendars = useApi<Calendar[]>('/api/v1/calendars');
  const base = window.location.origin;

  return (
    <>
      {scopes.map((scope) => {
        const own = (calendars.data ?? []).filter((calendar) => calendar.scope_id === scope.id);
        return (
          <Group key={scope.id} title={scope.name}>
            {own.length === 0 ? (
              <EmptyState>{t('settings.empty.calendars')}</EmptyState>
            ) : (
              own.map((calendar) => (
                <div key={calendar.id} style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
                  {calendar.name} · {calendar.kind === 'todos' ? t('settings.caldavTodos') : t('settings.caldavEvents')}
                </div>
              ))
            )}

            {/*
              Cada àmbit en publica DUES (D9): esdeveniments i tasques. Han d'estar
              etiquetades perquè s'entengui quina és quina; una llista de dues URL
              gairebé iguals sense etiqueta és una invitació a triar la que no toca.
            */}
            <div style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-soft)' }}>
                {t('settings.caldavUrls')}
              </span>
              {(['events', 'todos'] as const).map((kind) => (
                <div key={kind} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--ink-faint)', minWidth: 90 }}>
                    {kind === 'todos' ? t('settings.caldavTodos') : t('settings.caldavEvents')}
                  </span>
                  <input
                    readOnly
                    data-testid={`caldav-${scope.id}-${kind}`}
                    value={`${base}/dav/calendars/${scope.id}-${kind}/`}
                    onFocus={(event) => event.currentTarget.select()}
                    className="plou-input"
                    style={{ fontSize: 11.5 }}
                  />
                </div>
              ))}
            </div>
          </Group>
        );
      })}
    </>
  );
}

function McpTab() {
  const tokens = useApi<{ data: ApiTokenSummary[] }>('/api/v1/tokens');
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);

  const create = useMutation(async () => {
    if (name.trim() === '') return;
    const result = await api.post<{ token: string }>('/api/v1/tokens', {
      name: name.trim(),
      capabilities: ['tasks:read', 'tasks:write', 'checklists:read', 'checklists:write'],
    });
    setCreated(result.token);
    setName('');
    tokens.reload();
  });

  return (
    <>
      <Group title={t('settings.tab.mcp')}>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
          {t('settings.mcpInstructions')}
        </p>
        <input
          readOnly
          data-testid="mcp-url"
          value={`${window.location.origin}/mcp`}
          onFocus={(event) => event.currentTarget.select()}
          className="plou-input"
          style={{ fontSize: 12 }}
        />
      </Group>

      <Group title={t('tokens.title')}>
        {created !== null ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <input
              readOnly
              data-testid="token-value"
              value={created}
              onFocus={(event) => event.currentTarget.select()}
              className="plou-input"
              style={{ fontSize: 12 }}
            />
            {/* Un sol cop: del hash no se'n pot treure el token (docs/08 §5). */}
            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--danger-text)' }}>
              {t('tokens.onceWarning')}
            </p>
          </div>
        ) : null}

        {(tokens.data?.data ?? []).map((token) => (
          <div
            key={token.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 12.5,
              color: 'var(--ink-soft)',
            }}
          >
            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{token.name}</span>
            <span style={{ fontFamily: 'monospace' }}>{token.token_prefix}</span>
            <span>{token.last_used_at ?? t('tokens.never')}</span>
            <button
              type="button"
              data-testid={`token-revoke-${token.id}`}
              onClick={() => {
                void api.delete(`/api/v1/tokens/${token.id}`).then(() => {
                  tokens.reload();
                });
              }}
              style={{
                border: 'none',
                background: 'transparent',
                font: 'inherit',
                fontSize: 12,
                cursor: 'pointer',
                color: 'var(--danger-text)',
              }}
            >
              {t('tokens.revoke')}
            </button>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="plou-input"
            data-testid="token-name"
            value={name}
            placeholder={t('tokens.name')}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            type="button"
            className="plou-btn plou-btn-primary"
            data-testid="token-create"
            disabled={create.busy}
            onClick={() => void create.run()}
          >
            {t('tokens.create')}
          </button>
        </div>
      </Group>
    </>
  );
}

function AiTab() {
  const agents = useApi<Agent[]>('/api/v1/ai/agents');
  const [name, setName] = useState('');

  return (
    <Group title={t('settings.agents')}>
      {(agents.data ?? []).length === 0 ? (
        <EmptyState>{t('settings.empty.agents')}</EmptyState>
      ) : (
        (agents.data ?? []).map((agent) => (
          <div
            key={agent.id}
            style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12.5 }}
          >
            <span style={{ fontWeight: 600 }}>{agent.name}</span>
            <Toggle
              testId={`agent-enabled-${agent.id}`}
              label={t('settings.agentEnabled')}
              checked={agent.enabled}
              onChange={(value) => {
                void api.patch(`/api/v1/ai/agents/${agent.id}`, { enabled: value }).then(() => {
                  agents.reload();
                });
              }}
            />
            <Toggle
              testId={`agent-create-${agent.id}`}
              label={t('settings.agentCanCreate')}
              checked={agent.can_create_tasks}
              onChange={(value) => {
                void api
                  .patch(`/api/v1/ai/agents/${agent.id}`, { can_create_tasks: value })
                  .then(() => {
                    agents.reload();
                  });
              }}
            />
          </div>
        ))
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="plou-input"
          data-testid="agent-name"
          value={name}
          placeholder={t('settings.newAgent')}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="button"
          className="plou-btn plou-btn-primary"
          data-testid="agent-create"
          onClick={() => {
            if (name.trim() === '') return;
            void api.post('/api/v1/ai/agents', { id: uuidv7(), name: name.trim() }).then(() => {
              setName('');
              agents.reload();
            });
          }}
        >
          {t('nav.create')}
        </button>
      </div>
    </Group>
  );
}

function SharesTab() {
  const shares = useApi<{ data: ShareSummary[] }>('/api/v1/shares');

  return (
    <Group title={t('settings.tab.shares')}>
      {(shares.data?.data ?? []).length === 0 ? (
        <EmptyState>{t('settings.empty.shares')}</EmptyState>
      ) : (
        (shares.data?.data ?? []).map((share) => (
          <div key={share.id} style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
              <span style={{ fontWeight: 600 }}>{t(`share.permission.${share.permission}`)}</span>
              <span style={{ color: 'var(--ink-faint)' }}>
                {share.view_count} · {share.revoked_at === null ? '' : t('share.revoked')}
              </span>
              {share.revoked_at === null ? (
                <button
                  type="button"
                  data-testid={`share-revoke-${share.id}`}
                  onClick={() => {
                    void api.delete(`/api/v1/shares/${share.id}`).then(() => {
                      shares.reload();
                    });
                  }}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    font: 'inherit',
                    fontSize: 12,
                    cursor: 'pointer',
                    color: 'var(--danger-text)',
                  }}
                >
                  {t('share.revoke')}
                </button>
              ) : null}
            </div>
            <ShareAccesses shareId={share.id} />
          </div>
        ))
      )}
    </Group>
  );
}

function ShareAccesses({ shareId }: { shareId: string }) {
  const accesses = useApi<{ data: { id: string; label: string; last_seen: string }[] }>(
    `/api/v1/shares/${shareId}/accesses`,
  );
  const rows = accesses.data?.data ?? [];
  if (rows.length === 0) return null;

  return (
    <div style={{ paddingLeft: 14, display: 'grid', gap: 3 }}>
      {rows.map((access) => (
        <span key={access.id} style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
          {/* Pseudònim sempre: no hi ha cap columna d'IP enlloc (D10). */}
          {access.label} · {access.last_seen.slice(0, 10)}
        </span>
      ))}
    </div>
  );
}

function ProfileTab() {
  const { profile } = useSessionData();
  const { updateProfile } = useSession();
  const [name, setName] = useState(profile.name);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [done, setDone] = useState(false);

  const change = useMutation(async () => {
    await api.post('/api/v1/auth/password', {
      current_password: current,
      new_password: next,
    });
    setCurrent('');
    setNext('');
    setDone(true);
  });

  return (
    <>
      {/* El brief és explícit (línia 42): aquí NO s'editen els altres. */}
      <Group title={t('settings.tab.profile')}>
        <label style={{ display: 'grid', gap: 5 }}>
          <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{t('settings.profileName')}</span>
          <input
            className="plou-input"
            data-testid="profile-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              if (name.trim() !== '' && name !== profile.name) void updateProfile({ name });
            }}
          />
        </label>
        <div style={{ fontSize: 12.5, color: 'var(--ink-faint)' }}>{profile.email ?? ''}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-faint)' }}>{profile.timezone}</div>
      </Group>

      <Group title={t('settings.changePassword')}>
        <input
          className="plou-input"
          type="password"
          data-testid="password-current"
          value={current}
          placeholder={t('settings.currentPassword')}
          onChange={(event) => setCurrent(event.target.value)}
        />
        <input
          className="plou-input"
          type="password"
          data-testid="password-new"
          value={next}
          placeholder={t('settings.newPassword')}
          onChange={(event) => setNext(event.target.value)}
        />
        {change.error !== undefined ? (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--danger-text)' }}>
            {change.error.message}
          </p>
        ) : null}
        {done ? (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-soft)' }}>
            {t('settings.passwordChanged')}
          </p>
        ) : null}
        <button
          type="button"
          className="plou-btn plou-btn-primary"
          data-testid="password-submit"
          disabled={change.busy}
          onClick={() => void change.run()}
        >
          {t('nav.save')}
        </button>
      </Group>
    </>
  );
}

function AdminTab() {
  const users = useApi<AdminUser[]>('/api/v1/admin/users');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [instanceName, setInstanceName] = useState('');

  useApi<{ name: string }>('/info');

  const send = useMutation(async () => {
    const result = await api.post<{ invite_url: string }>('/api/v1/admin/users/invite', {
      email,
      name,
    });
    setInvite(result.invite_url);
    setEmail('');
    setName('');
    users.reload();
  });

  const wipe = useMutation(async () => {
    await api.post('/api/v1/admin/wipe', { confirmation });
    setConfirmation('');
    window.location.assign('/');
  });

  return (
    <>
      <Group title={t('settings.users')}>
        {users.error !== undefined ? <ErrorBanner onRetry={users.reload} /> : null}
        {(users.data ?? []).map((user) => (
          <div
            key={user.id}
            style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}
          >
            <span style={{ fontWeight: 600 }}>{user.name}</span>
            <span style={{ color: 'var(--ink-faint)' }}>{user.email ?? ''}</span>
            <span style={{ color: 'var(--ink-faint)' }}>{t(`settings.role.${user.role}`)}</span>
            {user.pending_invite ? (
              <span style={{ color: 'var(--ink-faint)' }}>{t('settings.invitePending')}</span>
            ) : null}
          </div>
        ))}
      </Group>

      <Group title={t('settings.invite')}>
        <input
          className="plou-input"
          data-testid="invite-email"
          value={email}
          placeholder={t('settings.inviteEmail')}
          onChange={(event) => setEmail(event.target.value)}
        />
        <input
          className="plou-input"
          data-testid="invite-name"
          value={name}
          placeholder={t('settings.inviteName')}
          onChange={(event) => setName(event.target.value)}
        />
        {invite !== null ? (
          <input
            readOnly
            data-testid="invite-url"
            value={invite}
            onFocus={(event) => event.currentTarget.select()}
            className="plou-input"
            style={{ fontSize: 11.5 }}
          />
        ) : null}
        {send.error !== undefined ? (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--danger-text)' }}>
            {send.error.message}
          </p>
        ) : null}
        <button
          type="button"
          className="plou-btn plou-btn-primary"
          data-testid="invite-send"
          disabled={send.busy}
          onClick={() => void send.run()}
        >
          {t('settings.invite')}
        </button>
      </Group>

      <Group title={t('settings.wipe')}>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--danger-text)', lineHeight: 1.5 }}>
          {t('settings.wipeWarning')}
        </p>
        <input
          className="plou-input"
          data-testid="wipe-confirmation"
          value={confirmation}
          placeholder={t('settings.wipeConfirm', { name: instanceName })}
          onChange={(event) => setConfirmation(event.target.value)}
          onFocus={() => {
            if (instanceName === '') {
              void api.get<{ name: string }>('/info').then((info) => setInstanceName(info.name));
            }
          }}
        />
        <button
          type="button"
          data-testid="wipe-submit"
          disabled={wipe.busy || confirmation === ''}
          onClick={() => void wipe.run()}
          style={{
            padding: '9px 16px',
            borderRadius: 100,
            border: '1px solid var(--danger-text)',
            background: 'transparent',
            color: 'var(--danger-text)',
            font: 'inherit',
            fontSize: 12.5,
            fontWeight: 700,
            cursor: 'pointer',
            justifySelf: 'start',
          }}
        >
          {t('settings.wipe')}
        </button>
      </Group>
    </>
  );
}
