/**
 * La barra superior. docs/02 §3.
 *
 * Vuit peces, en aquest ordre: wordmark (que és un botó cap al tauler general), switch
 * Tasques/Calendari, chips d'àmbit, desplegable de projecte, botó `+`, botó de llistes
 * pinejades, espaiador i botó de perfil.
 *
 * **Només un menú obert alhora.** Es fa amb un sol estat i no amb tres booleans: amb
 * tres, obrir-ne un mentre n'hi ha un altre obert deixa els dos oberts fins que algú
 * recordi tancar l'altre, i aquest "algú recordi" s'oblida.
 *
 * Per sota de 860px es reorganitza en dues files (docs/02 §10): wordmark i perfil a
 * dalt; switch, chips i projecte a sota.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '@fem-ho/contracts';
import { ScopeChip, useIsMobile } from '@fem-ho/design-system/femho';
import { resolveScopeMode } from './scope-mode.js';
import { Brand } from './Brand.js';
import { Avatar } from './Avatar.js';
import { useRouter } from './router.js';
import { useSession, useSessionData } from './session.js';
import type { Checklist, Scope } from './types.js';

/**
 * Quin menú hi ha obert.
 *
 * El de projectes ara **és un per àmbit** —`project:<id>`— perquè n'hi ha un a cada xip.
 * Abans n'hi havia un de sol a la dreta de tots.
 */
type Menu = 'add' | 'pinned' | 'profile' | `project:${string}` | null;

/** El robot del commutador de la IA, tal com el dibuixa el prototip validat. */
/**
 * La xinxeta de les llistes pinejades.
 *
 * És la del prototip i la que `docs/02` §3 demana —"cercle de 38px amb icona de
 * xinxeta"—; aquí hi havia un emoji `📌`, que canvia de forma i de color a cada sistema
 * operatiu i no segueix ni el tema ni l'accent com fa la resta de la barra.
 */
function PinIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 17v5" />
      <path d="M8 3h8l1 6.2 3 2.8v2H4v-2l3-2.8z" />
    </svg>
  );
}

function RobotIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 8V4H8" />
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}

export interface TopBarProps {
  view: 'tasks' | 'calendar';
  activeScopeIds: string[];
  onActiveScopesChange: (ids: string[]) => void;
  /** Els projectes que es veuen. **Buit vol dir tots.** */
  projectIds: string[];
  onProjectsChange: (ids: string[]) => void;
  /** Les pinejades porten el títol de la tasca: el menú ensenya "Tasca · Llista". */
  pinned: (Checklist & { task_title?: string })[];
  onNewProject: () => void;
  onNewChecklist: () => void;
  onScopeWarning: (message: string) => void;
  /**
   * El commutador del kanban de la IA.
   *
   * Només surt si hi ha algun agent actiu: sense IA, un botó que gira el tauler cap a un
   * tauler buit no és una funció, és una pregunta sense resposta.
   */
  aiEnabled?: boolean;
  aiBoardActive?: boolean;
  /**
   * Quantes tasques esperen resposta teva.
   *
   * Va al commutador d'IA i no a una safata a part: el lloc on s'hi va és el kanban de la
   * IA, i un avís que no és al botó que hi porta fa fer un pas de més per res.
   */
  attentionCount?: number;
  /** Si hi ha cap àmbit amb registre de dedicació: decideix si el menú en porta les entrades. */
  timeTracking?: boolean;
  /** Com se'n diu, d'un projecte, als àmbits actius. Només canvia la paraula. */
  projectNoun?: 'project' | 'client';
  onToggleAiBoard?: () => void;
}

export function TopBar({
  view,
  activeScopeIds,
  onActiveScopesChange,
  projectIds,
  onProjectsChange,
  pinned,
  onNewProject,
  onNewChecklist,
  onScopeWarning,
  aiEnabled = false,
  aiBoardActive = false,
  attentionCount = 0,
  timeTracking = false,
  projectNoun = 'project',
  onToggleAiBoard,
}: TopBarProps) {
  const { profile, scopes, projects, settings, instance } = useSessionData();
  const mode = resolveScopeMode(instance, settings);
  const { logout } = useSession();
  const { navigate } = useRouter();
  const [menu, setMenu] = useState<Menu>(null);
  const barRef = useRef<HTMLElement | null>(null);
  const mobile = useIsMobile();

  // Es tanquen amb `Escape` i amb clic fora (docs/02 §3).
  useEffect(() => {
    if (menu === null) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null);
    };
    const onClick = (event: MouseEvent): void => {
      if (barRef.current?.contains(event.target as Node) !== true) setMenu(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [menu]);

  const toggleScope = (id: string): void => {
    const next = activeScopeIds.includes(id)
      ? activeScopeIds.filter((value) => value !== id)
      : [...activeScopeIds, id];

    // No es poden desactivar tots: si l'usuari desmarca l'últim, es rebutja el canvi.
    if (next.length === 0) {
      onScopeWarning(t('nav.lastScope'));
      return;
    }
    /**
     * **Una sola crida.**
     *
     * Canviar la selecció reinicia el filtre de projecte —un projecte d'un àmbit
     * desactivat no té sentit—, però això ho fa qui rep el canvi, no dues crides
     * seguides des d'aquí: totes dues llegien la mateixa URL i la segona esborrava el
     * que la primera acabava d'escriure. Els chips no feien res i no fallava res.
     */
    onActiveScopesChange(next);
  };

  /**
   * Els projectes triats d'un àmbit, i com es marquen.
   *
   * **La tria és per projecte i no per àmbit**: un àmbit sense res marcat vol dir "tots
   * els seus", i marcar-ne un el treu d'aquell estat. Així no cal desar un "tots" per
   * àmbit enlloc: la llista buida ja ho diu.
   */
  const projectsOf = (scopeId: string) =>
    projects.filter((project) => project.scope_id === scopeId);

  /**
   * Quan té sentit oferir el filtre de projectes d'un àmbit.
   *
   * **Ha de tenir projectes i ha d'estar encès.** El segon no hi era: un àmbit apagat no
   * té cap tasca al tauler, o sigui que el seu desplegable s'obria, es podia marcar el que
   * fos i no canviava res. Un botó que no fa res ensenya a ignorar la barra sencera — que
   * és exactament el motiu pel qual es va treure el desplegable global.
   *
   * Android ja ho feia així; la web no. Dues regles per al mateix control a dues
   * superfícies que han de sentir-se la mateixa cosa.
   */
  const canFilter = (scopeId: string): boolean =>
    activeScopeIds.includes(scopeId) && projectsOf(scopeId).length > 0;

  const toggleProject = (id: string): void => {
    onProjectsChange(
      projectIds.includes(id) ? projectIds.filter((other) => other !== id) : [...projectIds, id],
    );
  };

  /** Treu de la selecció tots els projectes d'aquest àmbit: torna a "tots els seus". */
  const clearScope = (scopeId: string): void => {
    const seus = new Set(projectsOf(scopeId).map((project) => project.id));
    onProjectsChange(projectIds.filter((id) => !seus.has(id)));
  };

  /**
   * La cara de qui ha entrat.
   *
   * Fins ara eren les inicials i prou; ara és el component que hi posa la foto a sobre si
   * la instància té Gravatar encès i la persona en té. Les inicials segueixen sent el cas
   * normal, no el pla B: en una casa, la majoria no en tindrà.
   */
  const avatar = <Avatar userId={profile.id} name={profile.name} size={36} />;

  const round = (label: string, key: Menu, content: ReactNode, badge?: number): ReactNode => (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={menu === key}
        aria-haspopup="menu"
        data-testid={`topbar-${key ?? ''}`}
        onClick={() => setMenu(menu === key ? null : key)}
        style={{
          width: 38,
          height: 38,
          borderRadius: '50%',
          border: '1px solid var(--card-border)',
          background: 'var(--tag-bg)',
          color: 'var(--ink)',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 700,
          position: 'relative',
        }}
      >
        {content}
        {badge !== undefined && badge > 0 ? (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: -3,
              right: -3,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              borderRadius: 100,
              background: 'var(--gradient-brand-2stop)',
              color: 'var(--on-brand)',
              fontSize: 10,
              fontWeight: 800,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            {badge}
          </span>
        ) : null}
      </button>
    </div>
  );

  /**
   * El desplegable d'un menú de la barra.
   *
   * **A mòbil va ancorat a la pantalla i no al botó.** Amb `right: 0` i 200-240px d'ample,
   * un botó que cau a la banda esquerra deixa el desplegable començant **fora de la
   * pantalla**: a 380px, el de la xinxeta sortia amb la vora esquerra a −140px, o sigui
   * amb la meitat inabastable. Es va veure mesurant-lo, no mirant-lo: a l'ull sembla un
   * menú una mica escapçat.
   *
   * A partir de `mobile` s'ancora als dos costats amb 12px de marge, que és el patró
   * normal en un telèfon i el que fa que no depengui d'on caigui el botó.
   */
  const menuBox = (children: ReactNode): ReactNode => (
    <div
      role="menu"
      style={{
        position: mobile ? 'fixed' : 'absolute',
        top: mobile ? 96 : 46,
        ...(mobile ? { left: 12, right: 12 } : { right: 0 }),
        minWidth: mobile ? undefined : 200,
        maxHeight: 260,
        overflowY: 'auto',
        // Flota per damunt del contingut: ha de ser opac. `--card-bg` és translúcid en
        // tema fosc i deixaria llegir el que hi ha a sota.
        background: 'var(--panel-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: 14,
        boxShadow: 'var(--card-shadow)',
        padding: 5,
        zIndex: 40,
      }}
    >
      {children}
    </div>
  );

  /**
   * Una llista pinejada al menú: **el nom i com va**.
   *
   * El disseny hi posa una segona línia amb el progrés, i és el que fa que el menú
   * serveixi de debò: amb quatre llistes pinejades, els noms sols obliguen a entrar a
   * cadascuna per saber quina té feina pendent.
   */
  const pinnedItem = (checklist: Checklist & { task_title?: string }): ReactNode => {
    const items = checklist.items ?? [];
    const done = items.filter((item) => item.done).length;

    return (
      <button
        key={checklist.id}
        type="button"
        role="menuitem"
        data-testid={`pinned-${checklist.id}`}
        onClick={() => {
          setMenu(null);
          navigate(`/lists/${checklist.id}`);
        }}
        style={{
          display: 'grid',
          gap: 2,
          width: '100%',
          textAlign: 'left',
          padding: '9px 11px',
          minHeight: mobile ? 44 : undefined,
          borderRadius: 10,
          border: 'none',
          background: 'transparent',
          font: 'inherit',
          cursor: 'pointer',
          color: 'var(--ink)',
        }}
      >
        {/*
          **La tasca i la llista, com als dos prototips.**

          Amb el nom de la llista sol, dues que es diguin "Encàrrecs" en tasques diferents
          són indistingibles — i el menú existeix precisament per saltar a la que toca.
        */}
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>
          {checklist.task_title === undefined || checklist.task_title === ''
            ? checklist.name
            : `${checklist.task_title} · ${checklist.name}`}
        </span>
        <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
          {t('nav.pinnedProgress', { done, total: items.length })}
        </span>
      </button>
    );
  };

  /**
   * Un ítem que es pot marcar i desmarcar, i **que no tanca el menú**.
   *
   * Triar tres projectes són tres clics; si cada clic tanqués el desplegable, serien tres
   * clics i tres reobertures. `menuItem` sí que el tanca, perquè allà cada opció és una
   * destinació.
   */
  const checkItem = (
    label: string,
    checked: boolean,
    onClick: () => void,
    testId: string,
  ): ReactNode => (
    <button
      key={testId}
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      data-testid={testId}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        textAlign: 'left',
        padding: '9px 11px',
        minHeight: mobile ? 44 : undefined,
        borderRadius: 10,
        border: 'none',
        background: 'transparent',
        font: 'inherit',
        fontSize: 13,
        cursor: 'pointer',
        color: 'var(--ink)',
      }}
    >
      <span aria-hidden="true" style={{ width: 14, opacity: checked ? 1 : 0.25 }}>
        {checked ? '✓' : '·'}
      </span>
      {label}
    </button>
  );

  const menuItem = (label: string, onClick: () => void, danger = false): ReactNode => (
    <button
      key={label}
      type="button"
      role="menuitem"
      onClick={() => {
        setMenu(null);
        onClick();
      }}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '9px 11px',
        minHeight: mobile ? 44 : undefined,
        borderRadius: 10,
        border: 'none',
        background: 'transparent',
        font: 'inherit',
        fontSize: 13,
        cursor: 'pointer',
        color: danger ? 'var(--danger-text)' : 'var(--ink)',
      }}
    >
      {label}
    </button>
  );

  return (
    <header
      ref={barRef}
      data-testid="topbar"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        background: 'var(--sidebar-bg)',
        backdropFilter: 'blur(14px)',
        borderBottom: '1px solid var(--card-border)',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      <div
        style={{
          maxWidth: 'var(--content-max, 1360px)',
          margin: '0 auto',
          padding: '10px 28px',
          display: 'flex',
          flexDirection: mobile ? 'column' : 'row',
          alignItems: mobile ? 'stretch' : 'center',
          gap: mobile ? 10 : 22,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <button
            type="button"
            data-testid="wordmark"
            aria-label={t('nav.openDashboard')}
            onClick={() => navigate('/dashboard')}
            style={{
              border: 'none',
              background: 'transparent',
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {/* El nom de la instància, o el seu logo. Deia «Fem-ho» escrit a mà. */}
            <Brand />
          </button>

          {mobile ? <div style={{ flex: 1 }} /> : null}
          {mobile ? profileButton() : null}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: mobile ? 10 : 22,
            flexWrap: 'wrap',
            flex: 1,
          }}
        >
          {/*
            **El selector d'àmbit, i només quan serveix per a alguna cosa.**

            En monoàmbit s'està en un àmbit i prou. Si només n'hi ha un, un desplegable amb
            una sola opció és un control que no fa res: ocupa lloc, convida a obrir-lo i no
            hi ha res a triar. Amb dos o més, és l'única manera d'anar de l'un a l'altre —i
            per això va **abans** del commutador de vista: primer on ets, després què hi
            mires.
          */}
          {mode === 'single' && scopes.length > 1 ? (
            <select
              className="plou-input"
              data-testid="scope-picker"
              aria-label={t('nav.scopePicker')}
              value={activeScopeIds[0] ?? ''}
              onChange={(event) => onActiveScopesChange([event.target.value])}
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                padding: '7px 10px',
                minHeight: mobile ? 44 : undefined,
                width: 'auto',
                maxWidth: 180,
              }}
            >
              {scopes.map((scope) => (
                <option key={scope.id} value={scope.id}>
                  {scope.name}
                </option>
              ))}
            </select>
          ) : null}

          <div
            role="tablist"
            /*
              Etiquetava la fila amb "Tasques", que és el nom d'una de les dues pestanyes:
              un lector de pantalla anunciava "Tasques, pestanya Tasques". El grup es diu
              què tries, no una de les opcions.
            */
            aria-label={t('nav.view')}
            data-testid="view-switch"
            style={{
              display: 'inline-flex',
              padding: 3,
              borderRadius: 100,
              background: 'var(--ghost-bg)',
            }}
          >
            {(
              [
                /*
                  **El calendari a l'esquerra i les tasques a la dreta.**

                  L'ordre no és estètic: el calendari és el que ve **abans**. És el marc
                  —què tens aquests dies— i les tasques són el que en fas. Llegint
                  d'esquerra a dreta, primer el que ve i després la feina, que és el mateix
                  ordre en què es pensa.
                */
                { key: 'calendar', label: t('nav.calendar'), href: '/calendar' },
                { key: 'tasks', label: t('nav.tasks'), href: '/' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={view === tab.key}
                data-testid={`view-${tab.key}`}
                onClick={() => navigate(tab.href)}
                style={{
                  padding: '7px 18px',
                  minHeight: mobile ? 44 : undefined,
                  borderRadius: 100,
                  border: 'none',
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 12.5,
                  fontWeight: view === tab.key ? 700 : 500,
                  background: view === tab.key ? 'var(--card-bg)' : 'transparent',
                  color: view === tab.key ? 'var(--ink)' : 'var(--ink-soft)',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/*
            **En monoàmbit, aquí hi ha els projectes.**

            És el mateix lloc i el mateix component: qui treballa en una sola cosa no vol
            triar entre àmbits —en té un— sinó entre les parts d'aquella cosa. L'àmbit es
            tria al selector de l'esquerra, quan n'hi ha més d'un.
          */}
          {mode === 'single' ? (
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }} data-testid="project-chips">
              {projectsOf(activeScopeIds[0] ?? '').map((project) => (
                <ScopeChip
                  key={project.id}
                  data-testid={`project-chip-${project.id}`}
                  label={project.name}
                  // Els projectes no tenen color propi: agafen el del seu àmbit, que és
                  // el que diu de qui són sense inventar-ne cap paleta nova.
                  color={`var(${scopes.find((s) => s.id === project.scope_id)?.color ?? '--plou-blue'})`}
                  active={projectIds.includes(project.id)}
                  aria-label={t('nav.projectToggle', { name: project.name })}
                  onClick={() => toggleProject(project.id)}
                />
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }} data-testid="scope-chips">
              {scopes.map((scope) => (
                <span key={scope.id} style={{ position: 'relative', display: 'flex' }}>
                  <ScopeChip
                    data-testid={`scope-${scope.id}`}
                    label={scope.name}
                    // El camp de l'API és el NOM del token (`--plou-blue`), no un valor CSS:
                    // passar-lo tal qual dona una declaració invàlida i el navegador cau al
                    // gris per defecte, amb el text blanc a sobre i il·legible.
                    color={`var(${scope.color})`}
                    active={activeScopeIds.includes(scope.id)}
                    aria-label={t('nav.scopeToggle', { name: scope.name })}
                    onClick={() => toggleScope(scope.id)}
                    style={
                      canFilter(scope.id)
                        ? { borderTopRightRadius: 0, borderBottomRightRadius: 0, paddingRight: 10 }
                        : undefined
                    }
                  />
                  {canFilter(scope.id) ? projectButton(scope) : null}
                </span>
              ))}
            </div>
          )}

          <div style={{ position: 'relative' }}>
            {round(t('nav.add'), 'add', '+')}
            {menu === 'add'
              ? menuBox(
                  <>
                    {menuItem(
                      t(projectNoun === 'client' ? 'nav.newProject.client' : 'nav.newProject'),
                      onNewProject,
                    )}
                    {menuItem(t('nav.newChecklistFull'), onNewChecklist)}
                  </>,
                )
              : null}
          </div>

          {/*
            El commutador del kanban de la IA.
            Actiu, s'omple amb el gradient de marca: és el mateix senyal que fa servir
            la vora del tauler i el distintiu, perquè els tres diguin el mateix.
          */}
          {aiEnabled && view === 'tasks' ? (
            <button
              type="button"
              data-testid="ai-board-toggle"
              aria-pressed={aiBoardActive}
              aria-label={t('board.ia.toggle')}
              title={t('board.ia.toggle')}
              onClick={onToggleAiBoard}
              style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                background: aiBoardActive ? 'var(--gradient-brand-2stop)' : 'var(--tag-bg)',
                color: aiBoardActive ? 'var(--on-brand)' : 'var(--ink-soft)',
              }}
            >
              <RobotIcon />
              {/*
                **El punt d'atenció, amb el recompte.** És el germà del punt de canvi
                autònom no vist, amb una diferència que és tota la gràcia: aquell marxa
                mirant-lo i aquest **no marxa fins que respons**.
              */}
              {attentionCount > 0 ? (
                <span
                  data-testid="ai-attention-count"
                  aria-label={t('ai.attention.pending', { count: attentionCount })}
                  title={t('ai.attention.pending', { count: attentionCount })}
                  style={{
                    position: 'absolute',
                    top: -3,
                    right: -3,
                    minWidth: 16,
                    height: 16,
                    padding: '0 4px',
                    borderRadius: 100,
                    background: 'var(--plou-orange)',
                    color: 'var(--on-brand)',
                    fontSize: 10,
                    fontWeight: 800,
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  {attentionCount}
                </span>
              ) : null}
            </button>
          ) : null}

          {/*
            **El botó hi és sempre, també sense cap llista pinejada** (`docs/14` P8).

            Aquí deia el contrari, seguint `docs/02` §3. El problema d'amagar-lo és que
            pinejar una llista **no es descobreix enlloc**: qui no n'ha pinejat mai cap no
            sap que es pot fer, i el control que ho ensenyaria només apareix quan ja ho
            saps. El prototip ho resol amb un buit que diu on es fa, i és el que hi ha.
          */}
          <div style={{ position: 'relative' }}>
            {round(t('nav.pinned'), 'pinned', <PinIcon />, pinned.length)}
            {menu === 'pinned'
              ? menuBox(
                  pinned.length === 0 ? (
                    <p
                      data-testid="pinned-empty"
                      style={{
                        margin: 0,
                        padding: '12px 10px',
                        fontSize: 12.5,
                        color: 'var(--ink-faint)',
                        lineHeight: 1.4,
                      }}
                    >
                      {t('nav.noPinned')}
                    </p>
                  ) : (
                    <>{pinned.map((checklist) => pinnedItem(checklist))}</>
                  ),
                )
              : null}
          </div>

          <div style={{ flex: 1 }} />
          {mobile ? null : profileButton()}
        </div>
      </div>
    </header>
  );

  /**
   * El botonet de projectes d'un xip d'àmbit.
   *
   * **Va enganxat al xip i no és el mateix botó**: el xip encén i apaga l'àmbit, i això
   * tria què se'n veu. Fer-ho tot amb un sol control voldria dir que per triar projectes
   * calgués tocar l'estat de l'àmbit, o al revés.
   *
   * Només surt si l'àmbit té projectes: un desplegable buit és una promesa que no es
   * compleix, i abans n'hi havia un de global que sortia sempre encara que no hi hagués
   * cap projecte enlloc.
   */
  function projectButton(scope: Scope): ReactNode {
    const seus = projectsOf(scope.id);
    const triats = seus.filter((project) => projectIds.includes(project.id));
    const key: Menu = `project:${scope.id}`;
    const actiu = activeScopeIds.includes(scope.id);

    return (
      <>
        <button
          type="button"
          data-testid={`scope-projects-${scope.id}`}
          aria-expanded={menu === key}
          aria-haspopup="menu"
          aria-label={t('nav.scopeProjects', { name: scope.name })}
          onClick={() => setMenu(menu === key ? null : key)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '9px 11px 9px 6px',
            borderRadius: '0 100px 100px 0',
            border: 'none',
            cursor: 'pointer',
            font: 'inherit',
            fontSize: 11.5,
            fontWeight: 700,
            minHeight: mobile ? 44 : undefined,
            // El mateix fons que el xip, perquè es llegeixin com una sola píndola.
            background: actiu ? `var(${scope.color})` : 'var(--ghost-bg)',
            color: actiu ? 'var(--on-brand)' : 'var(--ink-soft)',
            opacity: actiu ? 1 : 0.9,
          }}
        >
          {/*
            El recompte només si n'hi ha de triats. Amb "tots", un número seria soroll que
            no diu res: el que hi ha és el que hi havia.
          */}
          {triats.length > 0 ? triats.length : null}
          <span aria-hidden="true">▾</span>
        </button>

        {menu === key
          ? menuBox(
              <>
                {/*
                  "Tots" no és un projecte més: és **buidar la tria d'aquest àmbit**. Per
                  això es marca quan no hi ha res triat, i clicar-lo torna a aquell estat.
                */}
                {checkItem(
                  t('nav.allProjects'),
                  triats.length === 0,
                  () => clearScope(scope.id),
                  `scope-projects-${scope.id}-all`,
                )}
                {seus.map((project) =>
                  checkItem(
                    project.name,
                    projectIds.includes(project.id),
                    () => toggleProject(project.id),
                    `scope-project-${project.id}`,
                  ),
                )}
              </>,
            )
          : null}
      </>
    );
  }

  function profileButton(): ReactNode {
    return (
      <div style={{ position: 'relative' }}>
        {round(t('nav.profile'), 'profile', avatar)}
        {menu === 'profile'
          ? menuBox(
              <>
                <div
                  style={{
                    padding: '8px 11px',
                    fontSize: 12,
                    color: 'var(--ink-faint)',
                    lineHeight: 1.4,
                  }}
                >
                  <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{profile.name}</div>
                  {profile.email ?? ''}
                </div>
                {/*
                  **El Registre i les Estadístiques surten només si algun àmbit els té.**
                  Són una funció de nínxol —qui factura hores—: ensenyar-les a qui no les ha
                  demanades seria dues entrades de menú que no porten enlloc.
                */}
                {timeTracking ? menuItem(t('nav.registre'), () => navigate('/registre')) : null}
                {timeTracking
                  ? menuItem(t('nav.estadistiques'), () => navigate('/estadistiques'))
                  : null}
                {menuItem(t('nav.settings'), () => navigate('/settings'))}
                {menuItem(t('nav.logout'), () => void logout(), true)}
              </>,
            )
          : null}
      </div>
    );
  }
}
