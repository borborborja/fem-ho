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
import { useRouter } from './router.js';
import { useSession, useSessionData } from './session.js';
import type { Checklist } from './types.js';

type Menu = 'project' | 'add' | 'pinned' | 'profile' | null;

export interface TopBarProps {
  view: 'tasks' | 'calendar';
  activeScopeIds: string[];
  onActiveScopesChange: (ids: string[]) => void;
  projectId: string | null;
  onProjectChange: (id: string | null) => void;
  pinned: Checklist[];
  onNewProject: () => void;
  onNewChecklist: () => void;
  onScopeWarning: (message: string) => void;
}

export function TopBar({
  view,
  activeScopeIds,
  onActiveScopesChange,
  projectId,
  onProjectChange,
  pinned,
  onNewProject,
  onNewChecklist,
  onScopeWarning,
}: TopBarProps) {
  const { profile, scopes, projects } = useSessionData();
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

  const visibleProjects = projects.filter((project) => activeScopeIds.includes(project.scope_id));
  const projectName =
    projectId === null
      ? t('nav.allProjects')
      : (visibleProjects.find((project) => project.id === projectId)?.name ?? t('nav.allProjects'));

  const initials = profile.name
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

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

  const menuBox = (children: ReactNode): ReactNode => (
    <div
      role="menu"
      style={{
        position: 'absolute',
        top: 46,
        right: 0,
        minWidth: 200,
        maxHeight: 260,
        overflowY: 'auto',
        background: 'var(--card-bg)',
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
              fontSize: 24,
              fontWeight: 900,
              fontFamily: 'var(--font-sans)',
              backgroundImage: 'var(--gradient-brand-text)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            Fem-ho
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
          <div
            role="tablist"
            aria-label={t('nav.tasks')}
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
                { key: 'tasks', label: t('nav.tasks'), href: '/' },
                { key: 'calendar', label: t('nav.calendar'), href: '/calendar' },
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

          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }} data-testid="scope-chips">
            {scopes.map((scope) => (
              <ScopeChip
                key={scope.id}
                data-testid={`scope-${scope.id}`}
                label={scope.name}
                color={scope.color}
                active={activeScopeIds.includes(scope.id)}
                aria-label={t('nav.scopeToggle', { name: scope.name })}
                onClick={() => toggleScope(scope.id)}
              />
            ))}
          </div>

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              data-testid="project-filter"
              aria-expanded={menu === 'project'}
              aria-haspopup="menu"
              onClick={() => setMenu(menu === 'project' ? null : 'project')}
              style={{
                minWidth: 170,
                minHeight: mobile ? 44 : undefined,
                padding: '9px 16px',
                borderRadius: 100,
                border: '1px solid var(--card-border)',
                background: 'var(--ghost-bg)',
                color: 'var(--ink)',
                font: 'inherit',
                fontSize: 12.5,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {projectName} ▾
            </button>
            {menu === 'project'
              ? menuBox(
                  <>
                    {menuItem(t('nav.allProjects'), () => onProjectChange(null))}
                    {visibleProjects.map((project) =>
                      menuItem(project.name, () => onProjectChange(project.id)),
                    )}
                  </>,
                )
              : null}
          </div>

          <div style={{ position: 'relative' }}>
            {round(t('nav.add'), 'add', '+')}
            {menu === 'add'
              ? menuBox(
                  <>
                    {menuItem(t('nav.newProject'), onNewProject)}
                    {menuItem(t('nav.newChecklistFull'), onNewChecklist)}
                  </>,
                )
              : null}
          </div>

          {/* Si no n'hi ha cap, el botó no es mostra (docs/02 §3). */}
          {pinned.length > 0 ? (
            <div style={{ position: 'relative' }}>
              {round(t('nav.pinned'), 'pinned', '📌', pinned.length)}
              {menu === 'pinned'
                ? menuBox(
                    <>
                      {pinned.map((checklist) =>
                        menuItem(checklist.name, () => navigate(`/lists/${checklist.id}`)),
                      )}
                    </>,
                  )
                : null}
            </div>
          ) : null}

          <div style={{ flex: 1 }} />
          {mobile ? null : profileButton()}
        </div>
      </div>
    </header>
  );

  function profileButton(): ReactNode {
    return (
      <div style={{ position: 'relative' }}>
        {round(t('nav.profile'), 'profile', initials)}
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
                {menuItem(t('nav.settings'), () => navigate('/settings'))}
                {menuItem(t('nav.logout'), () => void logout(), true)}
              </>,
            )
          : null}
      </div>
    );
  }
}
