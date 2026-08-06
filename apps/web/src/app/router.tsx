/**
 * L'encaminador.
 *
 * Propi i mínim, com el runtime d'i18n i pel mateix motiu: Fem-ho té nou rutes, cap
 * d'elles imbricada, i cap càrrega diferida per ruta. Una biblioteca d'encaminament
 * portaria un model de rutes imbricades, càrregues de dades i estats de transició que
 * aquí no s'usarien, i una dependència més a `resolved-versions.json`.
 *
 * El que sí que fa bé, perquè és el que es nota si falla:
 *   - `pushState` de veritat, no hash: les URL han de ser compartibles i indexables.
 *   - Escolta `popstate`, o sigui que enrere i endavant del navegador funcionen.
 *   - Intercepta els clics als enllaços interns perquè no recarreguin la pàgina, però
 *     **deixa passar** els que porten modificador o `target`, que l'usuari fa servir per
 *     obrir en una pestanya nova.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface Route {
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
}

interface RouterApi {
  route: Route;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterApi | null>(null);

function currentRoute(): Route {
  return {
    path: window.location.pathname,
    params: {},
    query: new URLSearchParams(window.location.search),
  };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(currentRoute);

  const navigate = useCallback((to: string, options: { replace?: boolean } = {}) => {
    if (options.replace === true) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    setRoute(currentRoute());
  }, []);

  useEffect(() => {
    const onPop = (): void => {
      setRoute(currentRoute());
    };
    window.addEventListener('popstate', onPop);

    const onClick = (event: MouseEvent): void => {
      // Els modificadors i el botó del mig són "obre'm en una pestanya nova": no es
      // toquen mai.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as HTMLElement | null)?.closest('a');
      if (anchor === null || anchor === undefined) return;
      if (anchor.target !== '' && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      const href = anchor.getAttribute('href');
      if (href === null || !href.startsWith('/')) return;

      event.preventDefault();
      window.history.pushState(null, '', href);
      setRoute(currentRoute());
    };
    document.addEventListener('click', onClick);

    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('click', onClick);
    };
  }, []);

  const value = useMemo<RouterApi>(() => ({ route, navigate }), [route, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterApi {
  const value = useContext(RouterContext);
  if (value === null) throw new Error('useRouter fora de RouterProvider');
  return value;
}

/**
 * Compara un patró amb el camí actual i n'extreu els paràmetres.
 *
 * `/s/:token` contra `/s/abc` dona `{token: 'abc'}`. Sense coincidència, `null`. És tot
 * el que fa falta: no hi ha rutes opcionals ni comodins enmig.
 */
export function match(pattern: string, path: string): Record<string, string> | null {
  const wanted = pattern.split('/').filter((part) => part !== '');
  const actual = path.split('/').filter((part) => part !== '');
  if (wanted.length !== actual.length) return null;

  const params: Record<string, string> = {};
  for (const [index, part] of wanted.entries()) {
    const value = actual[index]!;
    if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(value);
    else if (part !== value) return null;
  }
  return params;
}
