/**
 * Hi ha una versió més nova?
 *
 * PER QUÈ HO PREGUNTA EL SERVIDOR I NO EL NAVEGADOR
 * -------------------------------------------------
 * És el mateix criteri que ja governa Gravatar: si ho fes cada pestanya, GitHub veuria la
 * IP de cada persona de la casa cada vegada que algú obre Ajustos. Fent-ho aquí, en veu
 * una: la del servidor. I de propina, la resposta es pot recordar, que és el que evita
 * que obrir Ajustos tres vegades siguin tres peticions.
 *
 * PER QUÈ ESTÀ ENCESA PER DEFECTE I GRAVATAR NO
 * ---------------------------------------------
 * Perquè el que s'envia no és el mateix. A Gravatar hi va **el hash del correu de
 * cadascú**, que per a una adreça que algú ja sospita és comprovable calculant-ne el hash
 * i comparant: encendre-ho és dir a un tercer quines adreces hi ha en aquesta casa. Aquí
 * és una petició anònima a un llistat públic, un cop cada sis hores, sense cap dada de
 * ningú. Es pot apagar amb `FEMHO_UPDATE_CHECK=false`.
 *
 * I S'APAGA SOLA SI NO ÉS EL TEU GITHUB
 * -------------------------------------
 * `FEMHO_SOURCE_URL` existeix perquè l'AGPL §13 dona dret al codi **de la versió que
 * t'estan servint**, i qui publiqui una versió modificada hi ha de posar la seva. Si
 * aquella URL no és un repositori de GitHub, aquí no es pregunta res: avisar-lo de les
 * versions d'un altre projecte seria dir-li que actualitzi a una cosa que no és la seva.
 */

import { safeFetch } from '../dav/fetch-safe.js';

export interface UpdateStatus {
  /** La que corre aquesta instància. */
  current: string;
  /** L'última publicada, o `null` si no s'ha pogut saber. */
  latest: string | null;
  /** Si `latest` és més nova que `current`. Amb `latest` nul, sempre fals. */
  available: boolean;
  /** On mirar-la. `null` si no hi ha res a enllaçar. */
  url: string | null;
  /**
   * Per què no se sap res, si no se'n sap.
   *
   * **Un error de xarxa no és un "estàs al dia"**: una instància sense sortida a internet
   * ho estaria dient sempre, i callaria precisament el dia que hi ha una actualització de
   * seguretat. Es distingeix, i la interfície ho diu.
   */
  reason: 'ok' | 'disabled' | 'not-github' | 'unreachable';
}

/** `owner/repo` d'una URL de GitHub, o `null` si no ho és. */
export function githubRepo(sourceUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;
  const parts = url.pathname.split('/').filter((part) => part !== '');
  if (parts.length < 2) return null;
  return `${parts[0]!}/${parts[1]!.replace(/\.git$/u, '')}`;
}

/**
 * Compara dues versions **semàntiques**, no cadenes.
 *
 * `"0.10.0" > "0.9.0"` és fals si es comparen com a text, i és exactament el cas que
 * arribarà: aquest projecte va per 0.4.0 i el salt de 0.9 a 0.10 és qüestió de mesos. Un
 * avís que desapareix sol quan més falta fa no el nota ningú fins que és tard.
 */
export function isNewer(latest: string, current: string): boolean {
  const parse = (value: string): number[] =>
    value
      .replace(/^v/u, '')
      // Un sufix de preversió (`-rc.1`) no compta per a la comparació de números.
      .split('-')[0]!
      .split('.')
      .map((part) => Number.parseInt(part, 10));

  const a = parse(latest);
  const b = parse(current);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;

  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

/** Sis hores. Prou per assabentar-se el mateix dia i lluny del límit de GitHub. */
const TTL_MS = 6 * 60 * 60 * 1000;

/**
 * **Es recorda el que diu GitHub, no el que en concloem.**
 *
 * La primera versió guardava l'`UpdateStatus` sencer, que porta `current` i `available`, i
 * es va veure provant-ho contra el GitHub de debò: la segona crida tornava la versió de
 * la primera. En producció no s'hauria manifestat mai —`currentVersion` no canvia dins
 * d'un procés— i hauria esperat el dia que algú la fes dependre de la petició.
 *
 * La memòria cau és sobre **una dada de fora**; el que en fem és nostre i es calcula cada
 * vegada, que a més no costa res.
 */
interface Cached {
  at: number;
  latest: string;
  url: string;
}
let cache: Cached | null = null;

/** Per a les proves: sense això, la primera prova deixa el resultat a la segona. */
export function forgetUpdateCache(): void {
  cache = null;
}

export interface UpdateOptions {
  enabled: boolean;
  sourceUrl: string;
  currentVersion: string;
  /** Injectable per a les proves; per defecte, `safeFetch`. */
  fetcher?: (url: string) => Promise<{ status: number; text: string }>;
  now?: () => number;
}

export async function checkForUpdate(options: UpdateOptions): Promise<UpdateStatus> {
  const base: Omit<UpdateStatus, 'reason'> = {
    current: options.currentVersion,
    latest: null,
    available: false,
    url: null,
  };

  if (!options.enabled) return { ...base, reason: 'disabled' };

  const repo = githubRepo(options.sourceUrl);
  if (repo === null) return { ...base, reason: 'not-github' };

  const now = (options.now ?? Date.now)();
  const releases = `https://github.com/${repo}/releases`;

  const resolt = (latest: string, url: string): UpdateStatus => ({
    current: options.currentVersion,
    latest: latest.replace(/^v/u, ''),
    available: isNewer(latest, options.currentVersion),
    url,
    reason: 'ok',
  });

  if (cache !== null && now - cache.at < TTL_MS) return resolt(cache.latest, cache.url);

  try {
    const fetcher =
      options.fetcher ??
      (async (url: string) => {
        const response = await safeFetch(url, { timeoutMs: 5000, maxBytes: 256 * 1024 });
        return { status: response.status, text: response.body };
      });

    const response = await fetcher(`https://api.github.com/repos/${repo}/releases/latest`);
    if (response.status !== 200) throw new Error(`GitHub ha respost ${String(response.status)}`);

    const parsed = JSON.parse(response.text) as { tag_name?: unknown; html_url?: unknown };
    const tag = typeof parsed.tag_name === 'string' ? parsed.tag_name : null;
    if (tag === null) throw new Error('la resposta no porta `tag_name`');

    const url = typeof parsed.html_url === 'string' ? parsed.html_url : releases;
    cache = { at: now, latest: tag, url };
    return resolt(tag, url);
  } catch {
    /**
     * **No es propaga l'error i no es recorda el fracàs.**
     *
     * Que GitHub no contesti no és un problema d'aquesta instància i no ha de fer petar
     * Ajustos. Però tampoc es guarda a la memòria cau: si es guardés, una caiguda de cinc
     * minuts deixaria la resposta "no se sap" clavada sis hores.
     */
    return { ...base, url: releases, reason: 'unreachable' };
  }
}
