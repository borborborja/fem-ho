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
import type { Agent, Checklist } from './types.js';
import type { TaskStatus } from '@fem-ho/contracts';
import { useApi } from './useApi.js';
import { BoardScreen } from '../screens/BoardScreen.js';
import { CalendarScreen } from '../screens/CalendarScreen.js';
import { DashboardScreen } from '../screens/DashboardScreen.js';
import { JoinScopeScreen } from '../screens/JoinScopeScreen.js';
import { InviteScreen, SetupScreen } from '../screens/GateScreens.js';
import { ListScreen } from '../screens/ListScreen.js';
import { LoginScreen } from '../screens/LoginScreen.js';
import { RegisterScreen } from '../screens/RegisterScreen.js';
import { PublicShareScreen } from '../screens/PublicShareScreen.js';
import { CommandPalette } from '../screens/CommandPalette.js';
import { SearchScreen } from '../screens/SearchScreen.js';
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

  /**
   * `/join/:token` és un convit **a un àmbit**, i `/invite/:token` un convit **a la
   * instància**. Es distingeixen a la URL perquè el que passa és molt diferent: el primer
   * demana que ja tinguis compte; el segon te'n crea un.
   */
  const join = match('/join/:token', route.path);
  if (join !== null) {
    if (state.status === 'anonymous') return <LoginScreen />;
    if (state.status === 'loading') return null;
    return <JoinScopeScreen token={join.token!} />;
  }

  /**
   * El registre, quan la instància l'obre.
   *
   * La pantalla hi és sempre i **qui decideix és el servidor**: si el registre està
   * tancat, respon 403 i el formulari ho ensenya. Amagar la ruta al client no protegiria
   * res —l'API és la mateixa per a tothom— i faria que un enllaç compartit portés a una
   * pàgina que no existeix en comptes de dir què passa.
   */
  if (route.path === '/register') {
    if (state.status === 'anonymous') return <RegisterScreen />;
    if (state.status === 'loading') return null;
  }

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

  /**
   * Els projectes que es veuen, **buit vol dir tots**.
   *
   * Abans era un de sol (`?project=`) i vivia en un desplegable a la dreta dels àmbits,
   * lluny del que filtra. Ara la tria és per àmbit i es poden marcar diversos alhora, o
   * sigui que el que viatja a la URL és una llista. Buit i "tots" són el mateix estat a
   * posta: no hi ha cap manera de dir "cap projecte", que no voldria dir res.
   */
  const projectsQuery = route.query.get('projects');
  const projectIds = projectsQuery === null || projectsQuery === '' ? [] : projectsQuery.split(',');
  const [warning, setWarning] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  /** Una tasca nova des de l'edició completa: quina columna, i si és per a la IA. */
  const [newTask, setNewTask] = useState<{ status: TaskStatus; forAi: boolean } | null>(null);
  const [aiBoard, setAiBoard] = useState(false);
  const [flip, setFlip] = useState<{ transform: string; transition: string } | undefined>(
    undefined,
  );
  const [sharingTask, setSharingTask] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const boardRef = useRef<HTMLDivElement | null>(null);

  const pinned = useApi<Checklist[]>('/api/v1/pinned-checklists');
  /**
   * Hi ha IA si hi ha algun agent actiu.
   *
   * No és una preferència a part: un commutador "activar la IA" que es pogués encendre
   * sense cap agent giraria el tauler cap a un tauler que no pot rebre res.
   */
  const agents = useApi<Agent[]>('/api/v1/ai/agents');
  const aiEnabled = (agents.data ?? []).some((agent) => agent.enabled);

  /**
   * El gir del tauler.
   *
   * Mig gir cap a fora, es canvia el contingut amagat de perfil, i mig gir cap a dins.
   * El salt del mig va sense transició i amb dos `requestAnimationFrame`: amb un de sol,
   * el navegador encara no ha pintat l'estat sense transició i anima el salt sencer, que
   * es veu com un gir de 180 graus a l'inrevés.
   */
  const toggleAiBoard = useCallback(() => {
    setFlip({ transform: 'rotateY(90deg)', transition: 'transform 240ms cubic-bezier(0.4,0,1,1)' });
    setTimeout(() => {
      setAiBoard((active) => !active);
      setFlip({ transform: 'rotateY(-90deg)', transition: 'none' });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setFlip({
            transform: 'rotateY(0deg)',
            transition: 'transform 240ms cubic-bezier(0,0,0.2,1)',
          });
          // I en acabar, es treu del tot: mentre hi hagi una transformada 3D, la capa
          // queda promoguda i el text del tauler perd el suavitzat de subpíxel.
          setTimeout(() => setFlip(undefined), 260);
        });
      });
    }, 240);
  }, []);

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
      onPalette: () => setPaletteOpen((open) => !open),
      onEscape: () => {
        setWarning(null);
        setPaletteOpen(false);
      },
    });
  }, [navigate, scopes, activeScopeIds, setQuery]);

  // Ajustos no porta ni switch de vista ni chips d'àmbit (docs/02 §9), i per tant no
  // porta `TopBar`: es pinta sencera.
  if (route.path === '/settings') return <SettingsScreen />;

  const view: 'tasks' | 'calendar' = route.path === '/calendar' ? 'calendar' : 'tasks';
  const list = match('/lists/:id', route.path);

  const fullHeight = list === null && view === 'tasks' && route.path === '/';

  return (
    <div
      style={{
        background: 'var(--page-bg)',
        /**
         * Al tauler, l'arrel és una columna d'alçada exacta i el `main` s'hi estira.
         *
         * El disseny validat ho escriu com `calc(100vh - 70px)`, els 70 de la seva barra.
         * Aquí la barra no fa sempre 70: al mòbil es reorganitza en dues files i els
         * chips poden embolicar. Amb el flex no cal saber quant fa —el que sobra és el
         * que hi ha— i al telèfon el tauler no acaba mig pam per sota de la pantalla.
         */
        ...(fullHeight
          ? { height: '100dvh', display: 'flex', flexDirection: 'column' as const }
          : { minHeight: '100vh' }),
      }}
    >
      <TopBar
        view={view}
        activeScopeIds={activeScopeIds}
        /**
         * Canviar d'àmbits **buida els projectes triats** (docs/02 §2): un projecte d'un
         * àmbit que s'acaba d'apagar filtraria el tauler sense que es vegi per què.
         */
        onActiveScopesChange={(ids) => setQuery({ scopes: ids.join(','), projects: null })}
        projectIds={projectIds}
        onProjectsChange={(ids) => setQuery({ projects: ids.length === 0 ? null : ids.join(',') })}
        pinned={pinned.data ?? []}
        // Els projectes viuen amb els àmbits: s'hi va directament, no a la porta.
        onNewProject={() => navigate('/settings?tab=scopes')}
        onNewChecklist={() => navigate('/settings')}
        onScopeWarning={setWarning}
        aiEnabled={aiEnabled}
        aiBoardActive={aiBoard}
        onToggleAiBoard={toggleAiBoard}
      />

      <main
        ref={boardRef}
        style={{
          maxWidth: 'var(--content-max, 1360px)',
          margin: '0 auto',
          padding: '20px 28px calc(28px + env(safe-area-inset-bottom, 0px))',
          /**
           * **El tauler omple la pantalla; la resta creix amb el contingut.**
           *
           * El disseny validat dona al tauler una alçada fixa —`calc(100vh - 70px)`, els
           * 70 de la barra— i fa que cada columna es desplaci per dins. Sense això, una
           * columna amb quaranta targetes estirava la pàgina i les altres tres quedaven
           * penjades a dalt amb un pam de buit a sota.
           *
           * Només al tauler: Ajustos, el cercador i el tauler general són documents i
           * s'han de poder llegir avall.
           */
          ...(fullHeight
            ? {
                flex: 1,
                minHeight: 0,
                /**
                 * **`minWidth: 0` no és decoració.** Un element de flex té `min-width:
                 * auto`, que val la mida mínima del contingut; amb el tauler a dins,
                 * aquesta mínima és l'amplada de les quatre columnes juntes, i al
                 * telèfon el `main` es feia 673px dins d'un cos de 412 i el tauler
                 * sortia per la dreta sense manera d'arribar-hi.
                 */
                minWidth: 0,
                boxSizing: 'border-box' as const,
                display: 'flex',
                flexDirection: 'column' as const,
              }
            : {}),
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
          <ListScreen
            checklistId={list.id!}
            onOpenTask={setOpenTask}
            onBack={() => navigate('/')}
          />
        ) : route.path === '/search' ? (
          <SearchScreen onOpenTask={setOpenTask} />
        ) : route.path === '/dashboard' ? (
          <DashboardScreen
            onOpenTask={setOpenTask}
            onNewTask={() => setNewTask({ status: 'inbox', forAi: false })}
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
            projectIds={projectIds}
            onOpenTask={setOpenTask}
            onNewTask={(status, forAi) => setNewTask({ status, forAi })}
            aiBoard={aiBoard}
            flip={flip}
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

      {newTask === null ? null : (
        <TaskModal
          create={newTask}
          onClose={() => setNewTask(null)}
          onChanged={() => setReloadKey((value) => value + 1)}
          onShare={setSharingTask}
          onOpenList={(checklistId) => {
            setNewTask(null);
            navigate(`/lists/${checklistId}`);
          }}
        />
      )}

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

      {paletteOpen ? (
        <CommandPalette
          destinations={[
            { id: 'tasks', label: t('nav.tasks'), href: '/' },
            { id: 'calendar', label: t('nav.calendar'), href: '/calendar' },
            { id: 'dashboard', label: t('nav.dashboard'), href: '/dashboard' },
            { id: 'search', label: t('nav.search'), href: '/search' },
            { id: 'settings', label: t('nav.settings'), href: '/settings' },
          ]}
          onNavigate={navigate}
          onOpenTask={setOpenTask}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}
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
