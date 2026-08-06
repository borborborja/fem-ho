/**
 * El client de l'API.
 *
 * Prim a posta: `fetch` amb el token, el refresc automàtic i la traducció dels errors
 * RFC 9457 a una excepció que la interfície pot ensenyar. No hi ha capa de memòria
 * cau aquí —això és de `sync/`, que ja té Dexie i la cua de sortida (docs/06)—, perquè
 * dues memòries cau del mateix serien dues fonts de veritat.
 *
 * **El refresc és rotatiu i només se n'intenta un a la vegada.** Amb quatre peticions
 * en paral·lel que caduquen alhora, quatre refrescos simultanis gastarien el mateix
 * token de refresc quatre vegades, i el servidor revoca la família sencera quan detecta
 * la reutilització d'un de gastat (docs/05 §1). Es comparteix una sola promesa.
 */

import { t } from '@fem-ho/contracts';

export interface Problem {
  type: string;
  title: string;
  status: number;
  /** En **anglès**, per a màquines: clients CalDAV, agents i qui programi contra l'API. */
  detail: string;
  /** Les dades de l'error. El client hi posa el text del catàleg. */
  params?: Record<string, string | number>;
}

/**
 * El text d'un error, en l'idioma de qui mira.
 *
 * El servidor envia `type` i `params`; el text el posa el catàleg. **Si no en té la
 * clau, s'ensenya el `detail` anglès**: un error nou del servidor pot ser lleig, però
 * mai deixa una pantalla muda ni obliga a desplegar les dues coses alhora.
 */
export function problemText(problem: Problem | undefined, fallback: string): string {
  if (problem === undefined) return fallback;
  const slug = problem.type.slice(problem.type.lastIndexOf('/') + 1);
  const key = `error.${slug}`;
  const text = t(key, problem.params ?? {});
  return text === key ? problem.detail : text;
}

/** Un error de l'API que la interfície pot ensenyar tal com ve. */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem | undefined;

  constructor(status: number, problem: Problem | undefined, fallback: string) {
    super(problemText(problem, fallback));
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
}

const STORAGE_KEY = 'femho.tokens';

/**
 * Els tokens viuen a `localStorage` i no en una cookie.
 *
 * Una cookie de sessió faria el CSRF possible i obligaria a un token anti-CSRF a cada
 * escriptura; i com que Android fa servir la mateixa API amb `Authorization: Bearer`,
 * tenir dos mecanismes voldria dir dos camins d'autenticació al servidor, que és
 * exactament el que la regla 8 prohibeix.
 */
export function loadTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<Tokens>;
    if (typeof parsed.access_token !== 'string' || typeof parsed.refresh_token !== 'string') {
      return null;
    }
    return { access_token: parsed.access_token, refresh_token: parsed.refresh_token };
  } catch {
    // Un `localStorage` corrupte o inaccessible (navegació privada estricta) no ha de
    // deixar l'app en blanc: es tracta com si no hi hagués sessió.
    return null;
  }
}

export function saveTokens(tokens: Tokens | null): void {
  try {
    if (tokens === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    // Sense emmagatzematge, la sessió dura el que duri la pestanya. És pitjor que
    // guardar-la, però molt millor que petar.
  }
}

let tokens: Tokens | null = loadTokens();
let refreshing: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

export function setTokens(next: Tokens | null): void {
  tokens = next;
  saveTokens(next);
}

export function currentTokens(): Tokens | null {
  return tokens;
}

/** Es crida quan el refresc falla: la interfície ha de tornar al login. */
export function onSessionExpired(handler: () => void): void {
  onSessionLost = handler;
}

async function refresh(): Promise<boolean> {
  const current = tokens;
  if (current === null) return false;

  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      });
      if (!res.ok) {
        setTokens(null);
        onSessionLost?.();
        return false;
      }
      setTokens((await res.json()) as Tokens);
      return true;
    } catch {
      // Una xarxa caiguda no és una sessió caducada: no es tanca res, i qui crida
      // rebrà l'error de xarxa i podrà reintentar.
      return false;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Capçaleres extra. `Authorization` i `content-type` les posa el client. */
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Una petició a l'API.
 *
 * Un `401` s'intenta refrescar **un sol cop** i es reintenta. Reintentar-ho en bucle
 * amb un token que ja no val convertiria una sessió caducada en una tempesta de
 * peticions contra el servidor.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { ...options.headers };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (tokens !== null) headers.authorization = `Bearer ${tokens.access_token}`;

    return fetch(path.startsWith('/') ? path : `/api/v1/${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  };

  let res = await send();
  if (res.status === 401 && tokens !== null) {
    if (await refresh()) res = await send();
  }

  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    let problem: Problem | undefined;
    try {
      problem = (await res.json()) as Problem;
    } catch {
      problem = undefined;
    }
    throw new ApiError(res.status, problem, `HTTP ${String(res.status)}`);
  }

  const text = await res.text();
  return (text === '' ? undefined : JSON.parse(text)) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal): Promise<T> =>
    request<T>(path, signal === undefined ? {} : { signal }),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'POST', ...(body === undefined ? {} : { body }) }),
  patch: <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
};
