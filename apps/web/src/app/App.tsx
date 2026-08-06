/**
 * L'aplicació: quina pantalla es pinta i què comparteixen totes.
 *
 * Tres pantalles de primer nivell (docs/02 §1): **login**, **app** i **compartit
 * públic**. Dins d'app: tauler, tauler general i ajustos. La pàgina pública i la
 * invitació es resolen ABANS de mirar si hi ha sessió, perquè qui hi arriba no en té i
 * enviar-lo al login seria una porta tancada amb la clau a dins.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@fem-ho/contracts';
import { SyncPill } from '@fem-ho/design-system/femho';
import { match, useRouter } from './router.js';
import { useSession, useSessionData } from './session.js';
import { installShortcuts } from './shortcuts.js';
import { TopBar } from './TopBar.js';
import type { Checklist } from './types.js';
import { useApi } from './useApi.js';
import { BoardScreen } from '../screens/BoardScreen.js';
import { CalendarScreen } from '../screens/CalendarScreen.js';
import { DashboardScreen } from '../screens/DashboardScreen.js';
import { InviteScreen, SetupScreen } from '../screens/GateScreens.js';
import { ListScreen } from '../screens/ListScreen.js';
import { LoginScreen } from '../screens/LoginScreen.js';
import { PublicShareScreen } from '../screens/PublicShareScreen.js';
import { SettingsScreen } from '../screens/SettingsScreen.js';
import { TaskModal } from '../screens/TaskModal.js';
import { ShareTaskDialog } from '../screens/ShareTaskDialog.js';
import { ProofRoute } from '../proof/ProofRoute.js';

export function App() {
  const { route } = useRouter();
  const { state } = useSession();

  /**
   * Les pàgines de comprovació aïllada, sota `/proof/*`.
   *
   * Piten un component amb dades fixes i **sense servidor**: és el que fa que les
   * proves de tokens, d'arrossegament amb teclat i de xips d'afegida ràpida siguin
   * ràpides i no depenguin de cap base. No són l'app i no han de sortir enlloc de la
   * navegació; les proves hi van per URL directa.
   */
  if (route.path.startsWith('/proof/')) return <ProofRoute path={route.path} />;

  const share = match('/s/:token', route.path);
  if (share !== null) return <PublicShareScreen token={share.token!} />;

  const invite = match('/invite/:token', route.path);
  if (invite !== null) return <InviteScreen token={invite.token!} />;

  if (route.path === '/setup') {
    return <SetupScreen onDone={() => window.location.assign('/')} />;
  }

  if (state.status === 'loading') {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <p style={{ fontSize: 13, color: 'var(--ink-faint)' }}>{t('state.loading')}</p>
      </main>
    );
  }

  if (state.status === 'anonymous') return <LoginScreen />;
  return <AppShell />;
}

function AppShell() {
  const { route, navigate } = useRouter();
  const { scopes } = useSessionData();

  /**
   * Els àmbits actius viuen a la URL i no a l'estat.
   *
   * Així un enllaç al tauler filtrat es pot compartir i sobreviu a una recàrrega, que
   * és el que la gent espera d'una web. Sense `scopes` a la query, s'agafen tots.
   */
  const fromQuery = route.query.get('scopes');
  const activeScopeIds =
    fromQuery === null || fromQuery === ''
      ? scopes.map((scope) => scope.id)
      : fromQuery.split(',').filter((id) => scopes.some((scope) => scope.id === id));

  const projectId = route.query.get('project');
  const [warning, setWarning] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [sharingTask, setSharingTask] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const boardRef = useRef<HTMLDivElement | null>(null);

  const pinned = useApi<Checklist[]>('/api/v1/pinned-checklists');

  /**
   * Els paràmetres es llegeixen de la ubicació VIVA, no de la del render.
   *
   * Amb `route.query` tancat dins del callback, dues crides seguides dins del mateix
   * tic llegeixen totes dues l'estat anterior i la segona desfà la primera. És
   * exactament el que passava en canviar d'àmbit: el chip no feia res i no fallava res.
   */
  const setQuery = useCallback(
    (changes: Record<string, string | null>) => {
      const query = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === '') query.delete(key);
        else query.set(key, value);
      }
      const search = query.toString();
      navigate(`${window.location.pathname}${search === '' ? '' : `?${search}`}`, {
        replace: true,
      });
    },
    [navigate],
  );

  useEffect(() => {
    return installShortcuts({
      onQuickAdd: () => {
        const field = boardRef.current?.querySelector<HTMLInputElement>('input[role="combobox"]');
        field?.focus();
      },
      onTasks: () => navigate('/'),
      onCalendar: () => navigate('/calendar'),
      onScope: (index) => {
        const scope = scopes[index];
        if (scope === undefined) return;
        const next = activeScopeIds.includes(scope.id)
          ? activeScopeIds.filter((id) => id !== scope.id)
          : [...activeScopeIds, scope.id];
        if (next.length === 0) {
          setWarning(t('nav.lastScope'));
          return;
        }
        setQuery({ scopes: next.join(','), project: null });
      },
      onDashboard: () => navigate('/dashboard'),
      onSettings: () => navigate('/settings'),
      onSearch: () => navigate('/search'),
      onHelp: () => setWarning(t('shortcuts.title')),
      onEscape: () => {
        setWarning(null);
      },
    });
  }, [navigate, scopes, activeScopeIds, setQuery]);

  // Ajustos no porta ni switch de vista ni chips d'àmbit (docs/02 §9), i per tant no
  // porta `TopBar`: es pinta sencera.
  if (route.path === '/settings') return <SettingsScreen />;

  const view: 'tasks' | 'calendar' = route.path === '/calendar' ? 'calendar' : 'tasks';
  const list = match('/lists/:id', route.path);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <TopBar
        view={view}
        activeScopeIds={activeScopeIds}
        onActiveScopesChange={(ids) => setQuery({ scopes: ids.join(','), project: null })}
        projectId={projectId}
        onProjectChange={(id) => setQuery({ project: id })}
        pinned={pinned.data ?? []}
        onNewProject={() => navigate('/settings')}
        onNewChecklist={() => navigate('/settings')}
        onScopeWarning={setWarning}
      />

      <main
        ref={boardRef}
        style={{
          maxWidth: 'var(--content-max, 1360px)',
          margin: '0 auto',
          padding: '20px 28px calc(28px + env(safe-area-inset-bottom, 0px))',
        }}
      >
        {warning === null ? null : (
          <div
            role="status"
            data-testid="app-warning"
            style={{
              marginBottom: 14,
              padding: '9px 13px',
              borderRadius: 12,
              background: 'var(--ghost-bg)',
              fontSize: 12.5,
              color: 'var(--ink-soft)',
            }}
          >
            {warning}
          </div>
        )}

        {list !== null ? (
          <ListScreen checklistId={list.id!} onOpenTask={setOpenTask} />
        ) : route.path === '/dashboard' ? (
          <DashboardScreen
            onOpenTask={setOpenTask}
            onPickScope={(scopeId) => {
              navigate(`/?scopes=${scopeId}`);
            }}
          />
        ) : view === 'calendar' ? (
          <CalendarScreen activeScopeIds={activeScopeIds} onOpenTask={setOpenTask} />
        ) : (
          <BoardScreen
            key={reloadKey}
            activeScopeIds={activeScopeIds}
            projectId={projectId}
            onOpenTask={setOpenTask}
          />
        )}
      </main>

      <div
        style={{
          position: 'fixed',
          left: 20,
          bottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
          zIndex: 50,
        }}
      >
        <ConnectionPill />
      </div>

      {openTask === null ? null : (
        <TaskModal
          taskId={openTask}
          onClose={() => setOpenTask(null)}
          onChanged={() => setReloadKey((value) => value + 1)}
          onShare={setSharingTask}
          onOpenList={(checklistId) => {
            setOpenTask(null);
            navigate(`/lists/${checklistId}`);
          }}
        />
      )}

      {sharingTask === null ? null : (
        <ShareTaskDialog taskId={sharingTask} onClose={() => setSharingTask(null)} />
      )}
    </div>
  );
}

/**
 * La pastilla de connexió. docs/02 §12.
 *
 * "Sense connexió" és persistent; "Sincronitzat" surt dos segons i desapareix. La
 * diferència importa: un avís que se'n va deixa l'usuari sense saber si el que acaba
 * d'escriure s'ha desat.
 */
function ConnectionPill() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [justSynced, setJustSynced] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const goOnline = (): void => {
      setOnline(true);
      setJustSynced(true);
      // Es guarda fora perquè el netejador el pugui cancel·lar: si el component es
      // desmunta entremig, el `setState` cauria sobre un component mort.
      clearTimeout(timer);
      timer = setTimeout(() => setJustSynced(false), 2000);
    };
    const goOffline = (): void => setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const state = !online ? 'offline' : justSynced ? 'synced' : 'idle';
  return (
    <SyncPill
      state={state}
      data-testid="sync-pill"
      label={state === 'offline' ? t('sync.offline') : t('sync.synced')}
    />
  );
}
