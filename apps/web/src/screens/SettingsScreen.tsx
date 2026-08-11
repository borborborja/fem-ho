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
import {
  DEFAULT_MAIL_TEMPLATE,
  dateTime,
  getLocale,
  renderMailTitle,
  resolveWeekStart,
  t,
  unknownMailVars,
  weekdayNames,
} from '@fem-ho/contracts';
import { v7 as uuidv7 } from 'uuid';
import { EmptyState } from '@fem-ho/design-system/femho';
import { api, ApiError } from '../app/api.js';
import { Avatar } from '../app/Avatar.js';
import { Chips } from '../app/Chips.js';
import { useRouter } from '../app/router.js';
import { useSession, useSessionData } from '../app/session.js';
import { useApi, useMutation } from '../app/useApi.js';
import type {
  AdminUser,
  Agent,
  ApiTokenSummary,
  Calendar,
  Info,
  MailAccount,
  MailRule,
  MailTestResult,
  Member,
  Project,
  Scope,
  ShareSummary,
  UpdateStatus,
} from '../app/types.js';
import { ErrorBanner } from './BoardScreen.js';

/**
 * **El correu va en pestanya pròpia i no dins de «Calendaris».**
 *
 * Aquelles fonts són **de l'àmbit** i aquestes són **teves**: un calendari subscrit el veu
 * tot qui és a l'àmbit, i un compte de correu no el veu ningú més. Posar-los junts
 * convidaria a pensar el contrari, que amb una contrasenya personal pel mig és car.
 */
const TABS = [
  'general',
  'scopes',
  'calendars',
  'mail',
  'mcp',
  'ai',
  'shares',
  'profile',
  'admin',
] as const;
type Tab = (typeof TABS)[number];

export function SettingsScreen() {
  const { profile } = useSessionData();
  const { navigate, route } = useRouter();

  /**
   * La pestanya pot venir de la URL.
   *
   * **Perquè s'hi pugui enviar algú.** El menú `+` de la barra diu "Nou projecte" i
   * portava a Ajustos i prou: la persona queia a "General" i havia de trobar sola que els
   * projectes són a "Àmbits". Un menú que promet una acció i et deixa a la porta d'un
   * edifici no ha fet la seva feina.
   */
  const fromQuery = route.query.get('tab');
  const [tab, setTab] = useState<Tab>(
    TABS.includes(fromQuery as Tab) ? (fromQuery as Tab) : 'general',
  );

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
          {tab === 'mail' ? <MailTab /> : null}
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

/**
 * Si hi ha una versió més nova.
 *
 * **Un error de xarxa no es dibuixa com un "estàs al dia".** Una instància sense sortida
 * a internet ho estaria dient sempre, i callaria justament el dia que hi ha una
 * actualització de seguretat: el servidor distingeix `unreachable` d'`ok` i aquí es diu.
 *
 * Quan no hi ha res a dir —vas al dia, o la comprovació està apagada— **no es pinta res**.
 * Un "estàs al dia" permanent és una línia que la gent aprèn a no llegir, i llavors
 * l'avís que sí que importa cau al mateix sac.
 */
function UpdateNotice() {
  const update = useApi<UpdateStatus>('/api/v1/updates').data;
  if (update === undefined) return null;

  if (update.reason === 'unreachable') {
    return (
      <span data-testid="update-unreachable" style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
        {t('settings.update.unreachable')}
      </span>
    );
  }
  if (!update.available || update.latest === null) return null;

  return (
    <span
      data-testid="update-available"
      style={{
        fontSize: 12,
        color: 'var(--ink)',
        background: 'var(--tag-bg)',
        borderRadius: 10,
        padding: '9px 11px',
      }}
    >
      {t('settings.update.available', { version: update.latest })}{' '}
      {update.url === null ? null : (
        <a href={update.url} target="_blank" rel="noreferrer noopener">
          {t('settings.update.see')}
        </a>
      )}
    </span>
  );
}

function GeneralTab() {
  const { profile, settings } = useSessionData();
  const weekStart = resolveWeekStart(settings.week_start, getLocale());
  // `/info` és públic i sense autenticar: el dret al codi el té qualsevol que hi arribi.
  const info = useApi<Info>('/info').data ?? { version: '', license: '', source_url: '' };
  const { updateProfile, updateSettings } = useSession();

  return (
    <>
      {/*
        L'idioma va el primer de tot.
        És l'única preferència que canvia la pantalla on l'estàs triant: si algú hi ha
        arribat perquè l'app li surt en un idioma que no és el seu, ha de ser la primera
        cosa que trobi i no la sisena.
      */}
      <Group title={t('settings.language')}>
        <Chips
          testId="language-chips"
          value={profile.locale}
          options={[
            /**
             * check-ignore · cada idioma es diu **en el seu**.
             *
             * Qui busca el castellà busca "Español", no "Castellà", i qui busca el
             * català el busca escrit "Català" encara que tingui l'app en anglès. Passar
             * aquests tres noms pel catàleg voldria dir que la llista es tradueix
             * sencera i que ningú hi troba el seu.
             */
            { key: 'ca' as const, label: 'Català' },
            { key: 'en' as const, label: 'English' },
            { key: 'es' as const, label: 'Español' }, // check-ignore · veure a dalt
          ]}
          onChange={(locale) => void updateProfile({ locale })}
        />
      </Group>

      {/*
        El primer dia de la setmana, just sota l'idioma.
        `auto` el treu de la llengua —dilluns en català i castellà, diumenge en anglès—
        i aquí es pot manar per damunt: **no és només una convenció lingüística**, qui
        treballa el cap de setmana el vol d'una manera i qui no, d'una altra, i tots dos
        poden tenir la mateixa llengua.
      */}
      <Group title={t('settings.weekStart')}>
        <Chips
          testId="week-start"
          value={settings.week_start ?? 'auto'}
          options={[
            {
              key: 'auto' as const,
              label: t('settings.weekStart.auto', {
                day: weekdayNames(getLocale(), weekStart)[0] ?? '',
              }),
            },
            { key: 'monday' as const, label: weekdayNames(getLocale(), 1)[0] ?? '' },
            { key: 'sunday' as const, label: weekdayNames(getLocale(), 0)[0] ?? '' },
          ]}
          onChange={(value) => void updateSettings({ week_start: value })}
        />
      </Group>

      {/*
        Què li passa a la cita quan s'esborra la tasca que en va sortir.

        Viu aquí i no a la fitxa de cada esdeveniment perquè és **una manera de treballar**
        i no una decisió per cas: qui esborra una tasca derivada vol sempre el mateix, i
        preguntar-ho cada vegada seria un diàleg més al camí d'una acció que ja en té un.
      */}
      <Group title={t('settings.events.onDelete')}>
        <Chips
          testId="event-task-deleted"
          value={settings.event_task_deleted ?? 'return_to_inbox'}
          options={[
            {
              key: 'return_to_inbox' as const,
              label: t('settings.events.onDelete.return'),
              hint: t('settings.events.onDelete.returnHint'),
            },
            {
              key: 'hide_from_inbox' as const,
              label: t('settings.events.onDelete.hide'),
              hint: t('settings.events.onDelete.hideHint'),
            },
          ]}
          onChange={(value) => void updateSettings({ event_task_deleted: value })}
        />
      </Group>

      {/*
        **Article 13 de l'AGPL, no un crèdit.**

        Qui fa servir aquesta instància per la xarxa té dret al codi de la versió que li
        estan servint, i la manera d'oferir-lo és dir-li on és. La URL surt de `/info`,
        que la porta configurable: qui publiqui una versió modificada hi posarà la seva.
      */}
      <Group title={t('settings.about')}>
        <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
          {t('settings.source', { version: info.version, license: info.license ?? '' })}{' '}
          <a href={info.source_url ?? ''} target="_blank" rel="noreferrer noopener">
            {t('settings.sourceLink')}
          </a>
        </span>

        <UpdateNotice />

        {/*
          Els crèdits.

          **Plou hi surt amb nom propi i no com una dependència més**, perquè no ho és:
          `NOTICE` diu que és el design system d'un producte a part, vendoritzat aquí tal
          com ve i **amb condicions pròpies que no cobreix l'AGPL d'aquest repositori**.
          Amagar-ho a una llista de llibreries seria fer passar per nostre el que no ho és.
        */}
        <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
          {t('settings.credits')}
        </span>
      </Group>

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

/**
 * Els vuit colors d'àmbit de la paleta ampliada.
 *
 * `docs/00` reserva la tríada de Plou per als tres àmbits inicials i dona als que crea
 * l'usuari una paleta pròpia. Els vuit tokens existien a `femho/tokens.css` des del
 * primer dia i **no els feia servir ningú**: tots els àmbits creats des d'aquí sortien
 * blaus perquè el color anava cablejat.
 */
const SCOPE_COLORS = [
  '--femho-scope-1',
  '--femho-scope-2',
  '--femho-scope-3',
  '--femho-scope-4',
  '--femho-scope-5',
  '--femho-scope-6',
  '--femho-scope-7',
  '--femho-scope-8',
] as const;

function ColorPicker({
  value,
  onChange,
  testId,
}: {
  value: string;
  onChange: (color: string) => void;
  testId: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={t('settings.scopeColor')}
      data-testid={testId}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}
    >
      {SCOPE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          data-testid={`${testId}-${color}`}
          onClick={() => onChange(color)}
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: `var(${color})`,
            cursor: 'pointer',
            // La selecció es marca amb un anell separat i no amb una vora, que taparia
            // el color just al color que s'està triant.
            border: '2px solid var(--panel-bg)',
            boxShadow: value === color ? '0 0 0 2px var(--ink)' : 'none',
          }}
        />
      ))}
    </div>
  );
}

/**
 * Els projectes d'un àmbit, i com se'n fa un de nou.
 *
 * **Agrupats per àmbit i no en una llista plana** perquè un projecte no existeix sol: la
 * pregunta que es fa qui arriba aquí és "quins projectes té Feina", no "quins projectes
 * hi ha". I és la mateixa forma que després té el desplegable del xip.
 */
function ProjectsOfScope({ scope }: { scope: Scope }) {
  const projects = useApi<Project[]>(`/api/v1/projects?scope_id=${scope.id}`);
  const [name, setName] = useState('');

  const create = useMutation(async () => {
    if (name.trim() === '') return;
    await api.post('/api/v1/projects', { id: uuidv7(), scope_id: scope.id, name: name.trim() });
    setName('');
    projects.reload();
  });

  const rows = (projects.data ?? []).filter((project) => project.scope_id === scope.id);

  return (
    <div style={{ display: 'grid', gap: 6, paddingBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          aria-hidden="true"
          style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: `var(${scope.color})`,
          }}
        />
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{scope.name}</span>
      </div>

      {rows.length === 0 ? (
        <p style={{ ...HINT, paddingLeft: 17 }}>{t('settings.noProjects')}</p>
      ) : (
        rows.map((project) => (
          <div
            key={project.id}
            data-testid={`project-row-${project.id}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              paddingLeft: 17,
              fontSize: 12.5,
            }}
          >
            <span style={{ flex: 1 }}>{project.name}</span>
            <button
              type="button"
              className="plou-btn plou-btn-ghost"
              aria-label={t('settings.projectDelete')}
              style={{ color: 'var(--danger-text)' }}
              onClick={() => {
                void api.delete(`/api/v1/projects/${project.id}`).then(() => {
                  projects.reload();
                });
              }}
            >
              ×
            </button>
          </div>
        ))
      )}

      <div style={{ display: 'flex', gap: 8, paddingLeft: 17 }}>
        <input
          className="plou-input"
          data-testid={`new-project-${scope.id}`}
          value={name}
          placeholder={t('settings.projectName')}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void create.run();
          }}
        />
        <button
          type="button"
          className="plou-btn"
          data-testid={`new-project-create-${scope.id}`}
          disabled={create.busy}
          onClick={() => void create.run()}
        >
          {t('nav.create')}
        </button>
      </div>
    </div>
  );
}

function ScopeRow({ scope, onDone }: { scope: Scope; onDone: () => Promise<void> }) {
  const { profile } = useSessionData();
  // Qui mana a l'àmbit. `owner_id` mana sempre, hi hagi fila de membre o no.
  const isOwner = scope.owner_id === profile.id;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(scope.name);
  const [color, setColor] = useState(scope.color);
  const [kind, setKind] = useState<'individual' | 'collective'>(scope.kind);
  const [openMembers, setOpenMembers] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation(async () => {
    setError(null);
    try {
      await api.patch(`/api/v1/scopes/${scope.id}`, { name: name.trim(), color, kind });
      setEditing(false);
      await onDone();
    } catch (problem) {
      // El servidor diu QUI bloqueja el canvi de tipus i QUANTES coses queden a dins,
      // i `ApiError` ja en porta el text traduït. Ensenyar "no s'ha pogut" seria
      // fer-li endevinar què li falta.
      setError(problem instanceof ApiError ? problem.message : t('error.generic'));
    }
  });

  const remove = useMutation(async () => {
    setError(null);
    try {
      await api.delete(`/api/v1/scopes/${scope.id}`);
      await onDone();
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : t('error.generic'));
    }
  });

  return (
    <div style={{ display: 'grid', gap: 8 }} data-testid={`scope-row-${scope.id}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span
          aria-hidden="true"
          style={{ width: 9, height: 9, borderRadius: '50%', background: `var(${scope.color})` }}
        />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{scope.name}</span>
        <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
          {t(`settings.scopeKind.${scope.kind}`)}
        </span>
        <button
          type="button"
          data-testid={`scope-edit-${scope.id}`}
          onClick={() => setEditing(!editing)}
          style={LINK_BUTTON}
        >
          {t('settings.scopeEdit')}
        </button>
        {scope.kind === 'collective' ? (
          <button
            type="button"
            data-testid={`scope-members-${scope.id}`}
            onClick={() => setOpenMembers(!openMembers)}
            style={LINK_BUTTON}
          >
            {t('settings.members')}
          </button>
        ) : null}
      </div>

      {editing ? (
        <div style={{ display: 'grid', gap: 8, paddingLeft: 18 }}>
          <input
            className="plou-input"
            data-testid={`scope-name-${scope.id}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <ColorPicker value={color} onChange={setColor} testId={`scope-color-${scope.id}`} />
          <Chips
            testId={`scope-kind-${scope.id}`}
            value={kind}
            options={[
              { key: 'individual' as const, label: t('settings.scopeKind.individual') },
              { key: 'collective' as const, label: t('settings.scopeKind.collective') },
            ]}
            onChange={setKind}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="plou-btn plou-btn-primary"
              data-testid={`scope-save-${scope.id}`}
              disabled={save.busy}
              onClick={() => void save.run()}
            >
              {t('settings.scopeSave')}
            </button>
            <button
              type="button"
              className="plou-btn"
              data-testid={`scope-delete-${scope.id}`}
              disabled={remove.busy}
              onClick={() => {
                if (window.confirm(t('settings.scopeDeleteConfirm', { name: scope.name }))) {
                  void remove.run();
                }
              }}
            >
              {t('settings.scopeDelete')}
            </button>
          </div>
          {error === null ? null : (
            <p
              data-testid={`scope-error-${scope.id}`}
              style={{ fontSize: 12, color: 'var(--danger-text)', margin: 0 }}
            >
              {error}
            </p>
          )}
        </div>
      ) : null}

      {openMembers ? <MembersList scopeId={scope.id} canManage={isOwner} /> : null}
    </div>
  );
}

/** L'explicació petita sota d'un camp: el mateix pes a totes les pantalles. */
const HINT = { fontSize: 12, color: 'var(--ink-soft)', margin: 0 } as const;

const LINK_BUTTON = {
  border: 'none',
  background: 'transparent',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  color: 'var(--ink-soft)',
} as const;

/**
 * D'on surt un àmbit nou.
 *
 * Les tres portes que es van demanar, i **una sola pantalla**: crear-lo de nou, o
 * sincronitzar-lo amb un que ja existeix —d'aquest servidor, enganxant el token; o d'un
 * altre, enganxant també l'adreça—. Que siguin un commutador i no tres llocs diferents és
 * el que fa que no calgui saber abans quina de les tres es vol.
 */
type ScopeSource = 'new' | 'here' | 'remote';

function ScopesTab() {
  const { scopes } = useSessionData();
  const { reload } = useSession();
  const [source, setSource] = useState<ScopeSource>('new');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'individual' | 'collective'>('individual');
  const [color, setColor] = useState<string>(SCOPE_COLORS[0]);
  const [token, setToken] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation(async () => {
    setError(null);
    try {
      if (source === 'here') {
        // El mateix camí que la pantalla del convit: un token d'aquesta casa es bescanvia
        // i prou, i qui l'accepta ja és membre de l'àmbit que ja hi era.
        if (token.trim() === '') return;
        await api.post(`/api/v1/join/${encodeURIComponent(token.trim())}`);
      } else if (source === 'remote') {
        if (token.trim() === '' || serverUrl.trim() === '') return;
        await api.post('/api/v1/federation/links', {
          base_url: serverUrl.trim(),
          token: token.trim(),
          ...(name.trim() === '' ? {} : { name: name.trim() }),
        });
      } else {
        if (name.trim() === '') return;
        await api.post('/api/v1/scopes', { id: uuidv7(), name: name.trim(), kind, color });
      }
    } catch (problem: unknown) {
      setError(problem instanceof ApiError ? problem.message : String(problem));
      return;
    }
    setName('');
    setToken('');
    setServerUrl('');
    await reload();
  });

  return (
    <>
      <Group title={t('settings.tab.scopes')}>
        {scopes.map((scope) => (
          <ScopeRow key={scope.id} scope={scope} onDone={reload} />
        ))}
      </Group>

      {/*
        **Els projectes viuen aquí, amb els àmbits.**
        Fins ara només es podien crear des del `+` de la barra superior, que és el lloc on
        es va a fer coses i no a configurar-les. Un projecte és estructura, com un àmbit.
      */}
      <Group title={t('settings.projects')}>
        <p style={HINT}>{t('settings.projectsHelp')}</p>
        {scopes.map((scope) => (
          <ProjectsOfScope key={scope.id} scope={scope} />
        ))}
      </Group>

      <Group title={t('settings.newScope')}>
        <Chips
          testId="new-scope-source"
          value={source}
          options={[
            { key: 'new' as const, label: t('settings.scopeSource.new') },
            { key: 'here' as const, label: t('settings.scopeSource.here') },
            { key: 'remote' as const, label: t('settings.scopeSource.remote') },
          ]}
          onChange={setSource}
        />

        {source === 'new' ? (
          <>
            <input
              className="plou-input"
              data-testid="new-scope-name"
              value={name}
              placeholder={t('settings.scopeName')}
              onChange={(event) => setName(event.target.value)}
            />
            <ColorPicker value={color} onChange={setColor} testId="new-scope-color" />
            <Chips
              testId="new-scope-kind"
              value={kind}
              options={[
                { key: 'individual' as const, label: t('settings.scopeKind.individual') },
                { key: 'collective' as const, label: t('settings.scopeKind.collective') },
              ]}
              onChange={setKind}
            />
          </>
        ) : (
          <>
            <p style={HINT}>{t('settings.scopeSourceHelp')}</p>
            {source === 'remote' && (
              <input
                className="plou-input"
                data-testid="new-scope-server"
                value={serverUrl}
                placeholder={t('settings.scopeServerUrl')}
                onChange={(event) => setServerUrl(event.target.value)}
              />
            )}
            <input
              className="plou-input"
              data-testid="new-scope-token"
              value={token}
              placeholder={t('settings.scopeToken')}
              onChange={(event) => setToken(event.target.value)}
            />
          </>
        )}

        {error !== null && (
          <p role="alert" style={{ ...HINT, color: 'var(--danger-text)' }}>
            {error}
          </p>
        )}

        <button
          type="button"
          className="plou-btn plou-btn-primary"
          data-testid="new-scope-create"
          disabled={create.busy}
          onClick={() => void create.run()}
        >
          {source === 'new' ? t('nav.create') : t('settings.scopeJoin')}
        </button>
      </Group>
    </>
  );
}

interface ScopeInvite {
  id: string;
  role: string | null;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
  created_at: string;
}

/**
 * Els membres d'un àmbit, i com se n'hi posen.
 *
 * Fins avui això era **estrictament de lectura**: els endpoints de membres existien i no
 * els cridava ningú, i per afegir algú calia saber-ne l'identificador d'usuari i fer-ho a
 * mà. Ara hi ha el convit, que és el camí que fa que compartir sigui una cosa que es pugui
 * fer sense mirar la base de dades.
 */
function MembersList({ scopeId, canManage }: { scopeId: string; canManage: boolean }) {
  const members = useApi<Member[]>(`/api/v1/scopes/${scopeId}/members`);
  const invites = useApi<ScopeInvite[]>(canManage ? `/api/v1/scopes/${scopeId}/invites` : null);
  const [role, setRole] = useState<'collaborator' | 'viewer'>('collaborator');
  const [fresh, setFresh] = useState<string | null>(null);

  const invite = useMutation(async () => {
    const created = await api.post<{ invite_url: string }>(`/api/v1/scopes/${scopeId}/invites`, {
      role,
    });
    // **Surt una sola vegada.** Del hash no es pot recuperar (docs/10 §6).
    setFresh(created.invite_url);
    invites.reload();
  });

  return (
    <div style={{ paddingLeft: 18, display: 'grid', gap: 8 }}>
      <div style={{ display: 'grid', gap: 5 }}>
        {(members.data ?? []).map((member) => (
          <div
            key={member.id}
            data-testid={`member-${member.id}`}
            style={{ fontSize: 12.5, color: 'var(--ink-soft)', display: 'flex', gap: 8 }}
          >
            <span>
              {member.name ?? member.user_id ?? ''} · {t(`settings.role.${member.role}`)}
            </span>
            {canManage && member.role !== 'owner' ? (
              <button
                type="button"
                data-testid={`member-remove-${member.id}`}
                style={LINK_BUTTON}
                onClick={() => {
                  void api
                    .delete(`/api/v1/scopes/${scopeId}/members/${member.id}`)
                    .then(() => members.reload());
                }}
              >
                {t('settings.memberRemove')}
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {canManage ? (
        <>
          <Chips
            testId={`invite-role-${scopeId}`}
            value={role}
            options={[
              { key: 'collaborator' as const, label: t('settings.role.collaborator') },
              { key: 'viewer' as const, label: t('settings.role.viewer') },
            ]}
            onChange={setRole}
          />
          <button
            type="button"
            className="plou-btn"
            data-testid={`invite-create-${scopeId}`}
            disabled={invite.busy}
            onClick={() => void invite.run()}
          >
            {t('settings.inviteCreate')}
          </button>

          {fresh === null ? null : (
            <div style={{ display: 'grid', gap: 4 }}>
              <code
                data-testid={`invite-url-${scopeId}`}
                style={{
                  fontSize: 11.5,
                  background: 'var(--code-bg)',
                  padding: '6px 8px',
                  borderRadius: 8,
                  wordBreak: 'break-all',
                }}
              >
                {fresh}
              </code>
              <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
                {t('settings.inviteOnce')}
              </span>
            </div>
          )}

          {(invites.data ?? []).length === 0 ? null : (
            <div style={{ display: 'grid', gap: 4 }}>
              {(invites.data ?? []).map((row) => (
                <div key={row.id} style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
                  {t(`settings.role.${row.role ?? 'collaborator'}`)} · {row.use_count}/
                  {row.max_uses}{' '}
                  <button
                    type="button"
                    style={LINK_BUTTON}
                    data-testid={`invite-revoke-${row.id}`}
                    onClick={() => {
                      void api
                        .delete(`/api/v1/scopes/${scopeId}/invites/${row.id}`)
                        .then(() => invites.reload());
                    }}
                  >
                    {t('settings.inviteRevoke')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

/**
 * Un calendari d'un àmbit, i si els membres el veuen.
 *
 * **L'avís de credencials no és decoratiu.** El secret d'una font externa està segellat
 * amb una clau derivada del secret d'aquesta instància: no pot viatjar enlloc. El que sí
 * que passa, i no és obvi, és que si la font és bidireccional el que escriguin els
 * membres anirà al servei d'un tercer **amb les credencials del propietari**.
 */
function SharedCalendarRow({
  calendar,
  collective,
  onDone,
}: {
  calendar: Calendar;
  collective: boolean;
  onDone: () => void;
}) {
  const shared = calendar.shared_with_scope === true;

  const toggle = (): void => {
    if (!shared && calendar.has_credentials === true) {
      if (!window.confirm(t('settings.calendarCredWarning'))) return;
    }
    void api.patch(`/api/v1/calendars/${calendar.id}`, { shared_with_scope: !shared }).then(onDone);
  };

  return (
    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', display: 'flex', gap: 8 }}>
      <span>
        {calendar.name} ·{' '}
        {calendar.kind === 'todos' ? t('settings.caldavTodos') : t('settings.caldavEvents')}
      </span>
      {/*
        Només té sentit a un àmbit col·lectiu: a un d'individual no hi ha ningú amb qui
        compartir, i un commutador que no fa res convida a pensar que sí que en fa.
      */}
      {collective ? (
        <button
          type="button"
          data-testid={`calendar-share-${calendar.id}`}
          style={LINK_BUTTON}
          onClick={toggle}
        >
          {shared ? t('settings.calendarShared') : t('settings.calendarPrivate')}
        </button>
      ) : null}
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
                <SharedCalendarRow
                  key={calendar.id}
                  calendar={calendar}
                  collective={scope.kind === 'collective'}
                  onDone={() => calendars.reload()}
                />
              ))
            )}

            <SourcesForScope scope={scope} calendars={calendars} />

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

/**
 * Les fonts de dades d'un àmbit: CalDAV, iCal o RSS.
 *
 * `docs/07` §9 ja preveu un CalDAV o un `.ics` com a origen; el disseny validat hi
 * afegeix l'RSS. Els tres s'afegeixen igual i es veuen al calendari, on cadascú els pot
 * apagar sense treure'ls a ningú.
 *
 * **La contrasenya no es torna a ensenyar mai.** El camp es queda buit en carregar i
 * enviar-lo buit vol dir "no la toquis": desar el nom d'una font no ha de perdre'n les
 * credencials, i tornar-la a pintar la posaria al DOM de qualsevol pestanya oberta.
 */
function SourcesForScope({
  scope,
  calendars,
}: {
  scope: Scope;
  calendars: ReturnType<typeof useApi<Calendar[]>>;
}) {
  const [kind, setKind] = useState<'caldav' | 'ical' | 'rss'>('ical');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sources = (calendars.data ?? []).filter(
    (calendar) => calendar.scope_id === scope.id && calendar.origin === 'subscription',
  );

  const add = useMutation(async () => {
    if (url.trim() === '') {
      setError(t('settings.sources.urlRequired'));
      return;
    }
    setError(null);
    await api.post('/api/v1/calendars', {
      id: uuidv7(),
      scope_id: scope.id,
      name: name.trim() === '' ? url.trim() : name.trim(),
      kind: 'events',
      origin: 'subscription',
      source_kind: kind,
      source_url: url.trim(),
      source_username: kind === 'caldav' && username !== '' ? username : undefined,
      source_secret: kind === 'caldav' && password !== '' ? password : undefined,
    });
    setName('');
    setUrl('');
    setUsername('');
    setPassword('');
    calendars.reload();
  });

  return (
    <div style={{ display: 'grid', gap: 8 }} data-testid={`sources-${scope.id}`}>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-soft)' }}>
        {t('settings.sources')}
      </span>

      {sources.length === 0 ? (
        <EmptyState>{t('settings.sources.empty')}</EmptyState>
      ) : (
        sources.map((source) => (
          <div
            key={source.id}
            data-testid={`source-${source.id}`}
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              padding: '8px 10px',
              borderRadius: 12,
              background: 'var(--tag-bg)',
            }}
          >
            <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-soft)' }}>
              {t(`settings.sources.kind.${source.source_kind ?? 'ical'}`)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                {source.name}
              </div>
              {/*
                L'estat de l'últim refresc. Una font caiguda es veu exactament igual que
                una que no té esdeveniments —buida—, i sense dir-ho aquí ningú se
                n'assabenta fins que troba a faltar alguna cosa.
              */}
              <div
                style={{
                  fontSize: 11,
                  color: source.last_error == null ? 'var(--ink-faint)' : 'var(--danger-text)',
                }}
              >
                {source.last_error != null
                  ? t('settings.sources.failed', { reason: source.last_error })
                  : source.last_refreshed_at == null
                    ? t('settings.sources.never')
                    : t('settings.sources.refreshed', {
                        when: dateTime(getLocale(), new Date(source.last_refreshed_at)),
                      })}
              </div>
            </div>
            {/*
              A la bústia o només al calendari.
              **Es desa l'excepció i no l'estat**: si el valor triat coincideix amb el que
              el defecte ja diria, s'envia `null` i la base es queda buida. Així el dia
              que el defecte canviï, qui no hagi tocat res el segueix. La casella, en
              canvi, és un interruptor normal: ensenya `inbox_visible ?? el defecte`.
            */}
            <Toggle
              checked={source.inbox_visible ?? source.inbox_visible_default}
              label={t('settings.sources.inbox')}
              testId={`source-inbox-${source.id}`}
              onChange={(next) => {
                void api
                  .patch(`/api/v1/calendars/${source.id}`, {
                    inbox_visible: next === source.inbox_visible_default ? null : next,
                  })
                  .then(() => calendars.reload());
              }}
            />
            <button
              type="button"
              className="plou-btn plou-btn-ghost"
              data-testid={`source-remove-${source.id}`}
              onClick={() => {
                void api.delete(`/api/v1/calendars/${source.id}`).then(() => calendars.reload());
              }}
              style={{ fontSize: 11.5, padding: '4px 10px' }}
            >
              {t('settings.sources.remove')}
            </button>
          </div>
        ))
      )}

      <Chips
        testId={`source-kind-${scope.id}`}
        value={kind}
        options={[
          { key: 'caldav' as const, label: t('settings.sources.kind.caldav') },
          { key: 'ical' as const, label: t('settings.sources.kind.ical') },
          { key: 'rss' as const, label: t('settings.sources.kind.rss') },
        ]}
        onChange={setKind}
      />
      <input
        className="plou-input"
        data-testid={`source-name-${scope.id}`}
        placeholder={t('settings.sources.name')}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <input
        className="plou-input"
        data-testid={`source-url-${scope.id}`}
        placeholder={t('settings.sources.url')}
        value={url}
        onChange={(event) => setUrl(event.target.value)}
      />
      {/* Usuari i contrasenya només tenen sentit amb CalDAV: un `.ics` publicat i un RSS
          es baixen sense credencials. */}
      {kind === 'caldav' ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="plou-input"
            data-testid={`source-user-${scope.id}`}
            placeholder={t('settings.sources.username')}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <input
            className="plou-input"
            type="password"
            data-testid={`source-pass-${scope.id}`}
            placeholder={t('settings.sources.password')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
      ) : null}
      {error === null ? null : (
        <span style={{ fontSize: 11, color: 'var(--danger-text)' }}>{error}</span>
      )}
      <button
        type="button"
        className="plou-btn plou-btn-primary"
        data-testid={`source-add-${scope.id}`}
        disabled={add.busy}
        onClick={() => void add.run()}
        style={{ justifySelf: 'start' }}
      >
        {t('settings.sources.add')}
      </button>
    </div>
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
  const { profile, settings } = useSessionData();
  const { updateProfile, updateSettings } = useSession();
  const [name, setName] = useState(profile.name);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [done, setDone] = useState(false);
  const [gravatarSays, setGravatarSays] = useState<string | null>(null);

  /**
   * Omplir el nom amb el que hi ha a Gravatar.
   *
   * **Es proposa, no s'aplica sol.** Sobreescriure el nom que algú ha escrit aquí amb el
   * que va posar fa cinc anys en un altre lloc és canviar-li les dades sense demanar-ho;
   * per això és un botó i no una sincronització.
   */
  const fill = useMutation(async () => {
    const found = await api.get<{ display_name: string | null } | null>('/api/v1/me/gravatar');
    if (found?.display_name == null || found.display_name === '') {
      setGravatarSays(t('settings.gravatarNothing'));
      return;
    }
    setGravatarSays(null);
    setName(found.display_name);
    await updateProfile({ name: found.display_name });
  });

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
          <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
            {t('settings.profileName')}
          </span>
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

      <Group title="Gravatar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar userId={profile.id} name={profile.name} size={48} />
          <div style={{ display: 'grid', gap: 6 }}>
            <Toggle
              label={t('settings.gravatar')}
              testId="settings-gravatar"
              checked={settings.gravatar !== false}
              onChange={(value) => void updateSettings({ gravatar: value })}
            />
          </div>
        </div>

        {/*
          **Es diu què costa, i es diu bé.** "Només s'envia un hash" es llegeix sovint i no
          és cap protecció: per a una adreça que algú ja sospita, comprovar-la és calcular
          el hash i comparar.
        */}
        <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
          {t('settings.gravatarHelp')}
        </p>

        {gravatarSays !== null ? (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-soft)' }}>{gravatarSays}</p>
        ) : null}

        <button
          type="button"
          className="plou-btn"
          data-testid="settings-gravatar-fill"
          disabled={fill.busy || settings.gravatar === false}
          onClick={() => void fill.run()}
        >
          {t('settings.gravatarFill')}
        </button>
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

/**
 * El correu com a font d'entrada.
 *
 * Tres coses d'aquesta pantalla no són decoració:
 *
 * - **La contrasenya no es torna a ensenyar mai.** El camp neix buit i enviar-lo buit vol
 *   dir «no la toquis»: tornar-la a pintar la posaria al DOM de qualsevol pestanya oberta,
 *   i desar el nom del compte no ha de perdre'n les credencials.
 * - **«Prova la connexió» no desa res.** És el botó que estalvia les hores que es perden
 *   quan l'única manera de saber si unes credencials van bé és desar-les i esperar el
 *   cicle següent. Per això es pot provar una contrasenya **abans** de desar-la.
 * - **La previsualització del títol és en viu i la fa la mateixa funció que el servidor**
 *   (`renderMailTitle`, als contractes). Si fossin dues, un dia el que veus escrivint no
 *   seria el que et surt al tauler.
 *
 * I dues frases que hi són perquè la gent ha de saber-ho sense preguntar: **la primera
 * lectura d'una carpeta no ingereix res** i **res marca els teus correus com a llegits**.
 */
function MailTab() {
  const accounts = useApi<MailAccount[]>('/api/v1/mail/accounts');
  const rules = useApi<MailRule[]>('/api/v1/mail/rules');

  return (
    <>
      <Group title={t('settings.mail.accounts')}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-soft)' }}>
          {t('settings.mail.intro')}
        </p>

        {(accounts.data ?? []).length === 0 ? (
          <EmptyState>{t('settings.mail.empty')}</EmptyState>
        ) : (
          (accounts.data ?? []).map((account) => (
            <MailAccountRow
              key={account.id}
              account={account}
              onDone={() => {
                accounts.reload();
                rules.reload();
              }}
            />
          ))
        )}

        <MailAccountForm onDone={() => accounts.reload()} />
      </Group>

      <Group title={t('settings.mail.rules')}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-soft)' }}>
          {t('settings.mail.firstRun')} {t('settings.mail.notTouched')}
        </p>

        {(rules.data ?? []).length === 0 ? (
          <EmptyState>{t('settings.mail.rules.empty')}</EmptyState>
        ) : (
          (rules.data ?? []).map((rule) => (
            <MailRuleRow key={rule.id} rule={rule} onDone={() => rules.reload()} />
          ))
        )}

        {(accounts.data ?? []).length > 0 ? (
          <MailRuleForm accounts={accounts.data ?? []} onDone={() => rules.reload()} />
        ) : null}
      </Group>
    </>
  );
}

const camp = { display: 'grid', gap: 3, fontSize: 11.5, color: 'var(--ink-soft)' } as const;

/** Quan es va llegir per última vegada, o que encara no s'ha llegit mai. */
function quan(last: string | null | undefined): string {
  return last === null || last === undefined
    ? t('settings.mail.neverPolled')
    : t('settings.mail.lastPolled', { when: dateTime(getLocale(), new Date(last)) });
}

function Camp({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={camp}>
      {label}
      {children}
    </label>
  );
}

/** Un compte, amb el seu estat i el botó de provar. */
function MailAccountRow({ account, onDone }: { account: MailAccount; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [result, setResult] = useState<MailTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const test = useMutation(async () => {
    setError(null);
    setResult(null);
    try {
      // **No desa res**, ni tan sols la contrasenya que s'hi escriu per provar.
      setResult(
        await api.post<MailTestResult>(`/api/v1/mail/accounts/${account.id}/test`, {
          password: password === '' ? undefined : password,
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('error.generic'));
    }
  });

  const save = useMutation(async () => {
    setError(null);
    try {
      await api.patch<MailAccount>(`/api/v1/mail/accounts/${account.id}`, {
        // Buida vol dir «no la toquis».
        password: password === '' ? undefined : password,
        enabled: account.enabled,
      });
      setPassword('');
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('error.generic'));
    }
  });

  const remove = useMutation(async () => {
    await api.delete<void>(`/api/v1/mail/accounts/${account.id}`);
    onDone();
  });

  return (
    <div
      data-testid={`mail-account-${account.id}`}
      style={{
        display: 'grid',
        gap: 8,
        padding: 12,
        border: '1px solid var(--card-border)',
        borderRadius: 'var(--radius-card)',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>{account.name}</strong>
        <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
          {account.username}@{account.host}:{account.port}
        </span>
      </div>

      {/*
        L'estat de l'últim refresc, amb el motiu si va fallar. Va a la fila i no només al
        registre pel mateix motiu que als calendaris: una font caiguda es veu exactament
        igual que una que no té res.
      */}
      <span
        style={{
          fontSize: 11.5,
          color:
            account.last_error === null || account.last_error === undefined
              ? 'var(--ink-soft)'
              : 'var(--danger-text)',
        }}
      >
        {account.last_error ?? quan(account.last_polled_at)}
      </span>

      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <Camp label={t('settings.mail.password')}>
          <input
            type="password"
            className="plou-input"
            data-testid={`mail-password-${account.id}`}
            value={password}
            placeholder={account.has_secret ? t('settings.mail.passwordKept') : ''}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Camp>
        <button type="button" className="plou-btn" onClick={() => void test.run()}>
          {test.busy ? t('settings.mail.testing') : t('settings.mail.test')}
        </button>
        <button type="button" className="plou-btn" onClick={() => void save.run()}>
          {t('settings.mail.save')}
        </button>
        <button
          type="button"
          className="plou-btn plou-btn-ghost"
          data-testid={`mail-remove-${account.id}`}
          onClick={() => void remove.run()}
        >
          {t('settings.mail.remove')}
        </button>
      </div>

      {result !== null ? (
        <span
          data-testid={`mail-test-${account.id}`}
          style={{ fontSize: 11.5, color: result.ok ? 'var(--ink-soft)' : 'var(--danger-text)' }}
        >
          {result.ok
            ? t('settings.mail.testOk', { count: String(result.folders.length) })
            : t('settings.mail.testFail', { error: result.error ?? '' })}
        </span>
      ) : null}

      {/*
        **La pista que hauria estalviat una tarda.** «L'usuari o la contrasenya no són
        correctes» és cert i no serveix de res quan la contrasenya que llegeixes a la
        pantalla és la bona: el que falla és que el proveïdor no accepta la del compte, o
        que el que vas enganxar portava un espai que el camp no dibuixa.
      */}
      {result !== null && !result.ok ? (
        <span
          data-testid={`mail-hint-${account.id}`}
          style={{ fontSize: 11, color: 'var(--ink-soft)' }}
        >
          {t('settings.mail.appPassword')}
        </span>
      ) : null}

      {error !== null ? (
        <p role="alert" style={{ fontSize: 11.5, color: 'var(--danger-text)', margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function MailAccountForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [security, setSecurity] = useState<'tls' | 'starttls'>('tls');
  const [error, setError] = useState<string | null>(null);

  const add = useMutation(async () => {
    setError(null);
    try {
      await api.post<MailAccount>('/api/v1/mail/accounts', {
        id: uuidv7(),
        name: name.trim() === '' ? host.trim() : name.trim(),
        host: host.trim(),
        username: username.trim(),
        security,
        password: password === '' ? undefined : password,
      });
      setName('');
      setHost('');
      setUsername('');
      setPassword('');
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('error.generic'));
    }
  });

  return (
    <div style={{ display: 'grid', gap: 8 }} data-testid="mail-account-form">
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <Camp label={t('settings.mail.name')}>
          <input
            className="plou-input"
            data-testid="mail-new-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Camp>
        <Camp label={t('settings.mail.host')}>
          <input
            className="plou-input"
            data-testid="mail-new-host"
            value={host}
            onChange={(event) => setHost(event.target.value)}
          />
        </Camp>
        <Camp label={t('settings.mail.security')}>
          {/*
            **No hi ha «cap».** Oferir IMAP en clar vol dir que algú ho triarà i les seves
            credencials viatjaran nues per la xarxa de casa. El port el tria el servidor
            segons això: 993 amb TLS, 143 amb STARTTLS.
          */}
          <select
            className="plou-input"
            data-testid="mail-new-security"
            value={security}
            onChange={(event) =>
              setSecurity(event.target.value === 'starttls' ? 'starttls' : 'tls')
            }
          >
            <option value="tls">{t('settings.mail.security.tls')}</option>
            <option value="starttls">{t('settings.mail.security.starttls')}</option>
          </select>
        </Camp>
        <Camp label={t('settings.mail.username')}>
          <input
            className="plou-input"
            data-testid="mail-new-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </Camp>
        <Camp label={t('settings.mail.password')}>
          <input
            type="password"
            className="plou-input"
            data-testid="mail-new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Camp>
        <button
          type="button"
          className="plou-btn plou-btn-primary"
          data-testid="mail-add-account"
          onClick={() => void add.run()}
        >
          {t('settings.mail.add')}
        </button>
      </div>
      {error !== null ? (
        <p role="alert" style={{ fontSize: 11.5, color: 'var(--danger-text)', margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Els valors amb què es previsualitza una plantilla. Un correu creïble i prou. */
const MOSTRA = {
  subject: 'La factura de març',
  from_name: 'Escola',
  from_email: 'secretaria@escola.test',
  from: 'Escola',
  date: '11/08/2026',
  folder: 'INBOX/Escola',
  account: 'Personal',
};

function MailRuleRow({ rule, onDone }: { rule: MailRule; onDone: () => void }) {
  const { scopes } = useSessionData();
  const scope = scopes.find((s) => s.id === rule.scope_id);

  const remove = useMutation(async () => {
    await api.delete<void>(`/api/v1/mail/rules/${rule.id}`);
    onDone();
  });

  return (
    <div
      data-testid={`mail-rule-${rule.id}`}
      style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}
    >
      <strong style={{ fontSize: 12.5 }}>{rule.folder}</strong>
      <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
        → {scope?.name ?? rule.scope_id} ·{' '}
        {rule.action === 'task' ? t('settings.mail.action.task') : t('settings.mail.action.inbox')}
      </span>
      <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
        {renderMailTitle(rule.title_template, MOSTRA, MOSTRA.subject)}
      </span>
      <button
        type="button"
        className="plou-btn plou-btn-ghost"
        data-testid={`mail-rule-remove-${rule.id}`}
        onClick={() => void remove.run()}
      >
        {t('settings.mail.remove')}
      </button>
    </div>
  );
}

function MailRuleForm({ accounts, onDone }: { accounts: MailAccount[]; onDone: () => void }) {
  const { scopes } = useSessionData();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [folder, setFolder] = useState('');
  const [scopeId, setScopeId] = useState(scopes[0]?.id ?? '');
  const [action, setAction] = useState<'inbox' | 'task'>('inbox');
  const [template, setTemplate] = useState(DEFAULT_MAIL_TEMPLATE);
  const [error, setError] = useState<string | null>(null);

  const desconegudes = unknownMailVars(template);

  const add = useMutation(async () => {
    setError(null);
    try {
      await api.post<MailRule>('/api/v1/mail/rules', {
        id: uuidv7(),
        account_id: accountId,
        folder: folder.trim(),
        scope_id: scopeId,
        action,
        title_template: template,
      });
      setFolder('');
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('error.generic'));
    }
  });

  return (
    <div style={{ display: 'grid', gap: 8 }} data-testid="mail-rule-form">
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <Camp label={t('settings.mail.accounts')}>
          <select
            className="plou-input"
            data-testid="mail-rule-account"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </Camp>
        <Camp label={t('settings.mail.folder')}>
          {/*
            Text lliure i no una llista tancada: les carpetes es poden llistar amb «Prova
            la connexió», però una llista sense entrada lliure deixaria clavat qui té una
            carpeta que el servidor no anuncia.
          */}
          <input
            className="plou-input"
            data-testid="mail-rule-folder"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
          />
        </Camp>
        <Camp label={t('settings.mail.scope')}>
          <select
            className="plou-input"
            data-testid="mail-rule-scope"
            value={scopeId}
            onChange={(event) => setScopeId(event.target.value)}
          >
            {scopes.map((scope) => (
              <option key={scope.id} value={scope.id}>
                {scope.name}
              </option>
            ))}
          </select>
        </Camp>
        <Camp label={t('settings.mail.action')}>
          <select
            className="plou-input"
            data-testid="mail-rule-action"
            value={action}
            onChange={(event) => setAction(event.target.value === 'task' ? 'task' : 'inbox')}
          >
            <option value="inbox">{t('settings.mail.action.inbox')}</option>
            <option value="task">{t('settings.mail.action.task')}</option>
          </select>
        </Camp>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <Camp label={t('settings.mail.template')}>
          <input
            className="plou-input"
            data-testid="mail-rule-template"
            value={template}
            onChange={(event) => setTemplate(event.target.value)}
          />
        </Camp>
        <button
          type="button"
          className="plou-btn plou-btn-ghost"
          data-testid="mail-rule-preset"
          onClick={() => setTemplate('{{from_name}} - {{subject}}')}
        >
          {t('settings.mail.templatePreset')}
        </button>
        <button
          type="button"
          className="plou-btn plou-btn-primary"
          data-testid="mail-add-rule"
          onClick={() => void add.run()}
        >
          {t('settings.mail.addRule')}
        </button>
      </div>

      {/*
        La previsualització la fa la MATEIXA funció que el servidor. I les variables mal
        escrites s'avisen sense rebutjar-les: qui vulgui unes claus literals al títol està
        en el seu dret, i el que no ha de passar és que una errata sembli un camp buit.
      */}
      <span data-testid="mail-rule-preview" style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
        {t('settings.mail.templatePreview', {
          preview: renderMailTitle(template, MOSTRA, MOSTRA.subject),
        })}
      </span>
      {desconegudes.length > 0 ? (
        <span style={{ fontSize: 11.5, color: 'var(--warning-text)' }}>
          {t('settings.mail.templateUnknown', { vars: desconegudes.join(', ') })}
        </span>
      ) : null}

      {error !== null ? (
        <p role="alert" style={{ fontSize: 11.5, color: 'var(--danger-text)', margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
