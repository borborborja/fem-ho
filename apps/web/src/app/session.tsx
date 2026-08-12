/**
 * La sessió: qui ets, què veus i què pots fer.
 *
 * És l'única peça que sap si hi ha algú connectat. Tot el que necessita saber-ho hi
 * passa, i per això les pantalles no han de comprovar mai el token elles mateixes.
 *
 * Carrega el perfil, les preferències, els àmbits i els projectes **d'una tirada** en
 * entrar: són el que necessiten totes les pantalles i demanar-los per separat a cada
 * navegació donaria quatre estats de càrrega per a una sola pàgina.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, api, currentTokens, onSessionExpired, setTokens, type Tokens } from './api.js';
import { isLocale, negotiate, setLocale, type Locale } from '@fem-ho/contracts';
import { applyAccent, applyDefaults, applyTheme } from './theme.js';

/**
 * Posa l'idioma actiu i l'anuncia a la pàgina.
 *
 * L'`lang` de l'`<html>` no és decoració: és el que fa que el lector de pantalla llegeixi
 * amb la pronúncia bona i que el navegador ofereixi de traduir —o no— la pàgina. Amb un
 * `lang="ca"` fix, una pantalla en castellà es llegiria amb accent català.
 */
function applyLocale(value: unknown): void {
  const locale: Locale = isLocale(value) ? value : negotiate(navigator.languages);
  setLocale(locale);
  document.documentElement.lang = locale;
}
import type { Info, Project, Scope, UserProfile, UserSettings } from './types.js';

export interface SessionData {
  profile: UserProfile;
  settings: UserSettings;
  scopes: Scope[];
  projects: Project[];
  people: { id: string; name: string }[];
  /**
   * El que diu la instància: el nom, la marca i si deixa triar el mode d'àmbits.
   *
   * Va aquí i no a un `useApi` de cada pantalla perquè **el necessiten la barra, Ajustos i
   * el wizard alhora**, i tres crides a la mateixa cosa és com les tres acaben dient coses
   * diferents durant mig segon. És públic i barat: una crida més en paral·lel amb les
   * altres quatre.
   */
  instance: Info;
}

export type SessionState =
  { status: 'loading' } | { status: 'anonymous' } | { status: 'ready'; data: SessionData };

interface SessionApi {
  state: SessionState;
  login: (email: string, password: string) => Promise<void>;
  /**
   * Fer-se un compte i entrar-hi.
   *
   * Torna les mateixes credencials que el login, o sigui que aquí no hi ha res de
   * diferent: es desen i es carrega la sessió.
   */
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Torna a llegir el perfil, els àmbits i els projectes. */
  reload: () => Promise<void>;
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>;
  updateProfile: (patch: Partial<UserProfile>) => Promise<void>;
}

const SessionContext = createContext<SessionApi | null>(null);

async function fetchSession(): Promise<SessionData> {
  const [bundle, scopes, projects, members, instance] = await Promise.all([
    api.get<{ profile: UserProfile; settings: UserSettings }>('/api/v1/auth/settings'),
    api.get<Scope[]>('/api/v1/scopes'),
    api.get<Project[]>('/api/v1/projects'),
    api.get<{ id: string; name: string }[]>('/api/v1/admin/users').catch(() => null),
    api.get<Info>('/info'),
  ]);

  /**
   * La llista de persones surt d'Admin quan es pot, i si no, dels membres dels àmbits
   * col·lectius. Un membre normal no té `users:manage` i rebria un 403: **una llista de
   * persones buida trencaria l'autocompletat de `@` sense que res fallés a la vista**,
   * que és pitjor que una crida de més.
   */
  let people = members;
  if (people === null) {
    const perScope = await Promise.all(
      scopes
        .filter((scope) => scope.kind === 'collective')
        .map(async (scope) =>
          api
            .get<{ user_id: string | null; name: string | null }[]>(
              `/api/v1/scopes/${scope.id}/members`,
            )
            .catch(() => []),
        ),
    );
    const unics = new Map<string, string>();
    for (const member of perScope.flat()) {
      if (member.user_id !== null && member.name !== null) unics.set(member.user_id, member.name);
    }
    unics.set(bundle.profile.id, bundle.profile.name);
    people = [...unics].map(([id, name]) => ({ id, name }));
  }

  return { profile: bundle.profile, settings: bundle.settings, scopes, projects, people, instance };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(() =>
    currentTokens() === null ? { status: 'anonymous' } : { status: 'loading' },
  );

  const load = useCallback(async () => {
    try {
      const data = await fetchSession();
      applyTheme(data.profile.theme);
      applyAccent(data.profile.accent);
      applyLocale(data.profile.locale);
      setState({ status: 'ready', data });
    } catch (error) {
      // Un 401 vol dir sessió morta; qualsevol altra cosa és una fallada temporal i no
      // ha de fer fora ningú, però sense dades no hi ha res a pintar.
      if (error instanceof ApiError && error.status === 401) setTokens(null);
      applyDefaults();
      setState({ status: 'anonymous' });
    }
  }, []);

  useEffect(() => {
    applyDefaults();
    onSessionExpired(() => {
      applyDefaults();
      setState({ status: 'anonymous' });
    });
    if (currentTokens() !== null) void load();
  }, [load]);

  const value = useMemo<SessionApi>(
    () => ({
      state,
      login: async (email, password) => {
        const tokens = await api.post<Tokens>('/api/v1/auth/login', { email, password });
        setTokens(tokens);
        setState({ status: 'loading' });
        await load();
      },
      register: async (email, name, password) => {
        const tokens = await api.post<Tokens>('/api/v1/auth/register', {
          email,
          name,
          password,
          // L'idioma del navegador: l'únic moment en què "automàtic" és inequívoc, perquè
          // encara no hi ha perfil on algú hagi triat res.
          locale: navigator.language.slice(0, 2),
        });
        setTokens(tokens);
        setState({ status: 'loading' });
        await load();
      },
      logout: async () => {
        // El servidor ha de saber-ho per revocar la sessió; que la crida falli no ha
        // d'impedir sortir, perquè llavors no es podria sortir sense connexió.
        await api.post('/api/v1/auth/logout').catch(() => undefined);
        setTokens(null);
        applyDefaults();
        setState({ status: 'anonymous' });
      },
      reload: load,
      updateSettings: async (patch) => {
        const settings = await api.patch<UserSettings>('/api/v1/auth/settings', patch);
        setState((prev) =>
          prev.status === 'ready' ? { status: 'ready', data: { ...prev.data, settings } } : prev,
        );
      },
      updateProfile: async (patch) => {
        const profile = await api.patch<UserProfile>('/api/v1/auth/me', patch);
        applyTheme(profile.theme);
        applyAccent(profile.accent);
        applyLocale(profile.locale);
        setState((prev) =>
          prev.status === 'ready' ? { status: 'ready', data: { ...prev.data, profile } } : prev,
        );
      },
    }),
    [state, load],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession fora de SessionProvider');
  return value;
}

/**
 * La sessió quan ja se sap que hi és.
 *
 * Les pantalles de dins de l'app no s'han de defensar de `status: 'anonymous'`: el
 * router ja no les munta. Aquest hook ho fa explícit en comptes de deixar-ho a un `!`.
 */
export function useSessionData(): SessionData {
  const { state } = useSession();
  if (state.status !== 'ready') throw new Error('useSessionData sense sessió carregada');
  return state.data;
}
