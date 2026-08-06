/**
 * Peticions HTTP a URL que **dona l'usuari** (docs/10 §7).
 *
 * És la vulnerabilitat més seriosa del projecte: un compte qualsevol pot fer que el
 * servidor piqui a la xarxa interna de la casa —el router, altres contenidors, serveis
 * d'administració sense autenticar— i un servidor que s'autoallotja a casa és
 * exactament el cas on això fa mal.
 *
 * Les set mitigacions, i **cap és opcional**:
 *
 * 1. Només `http` i `https`.
 * 2. Resoldre el DNS primer i comprovar la **IP resolta**, no la cadena de l'amfitrió.
 * 3. Bloquejar rangs privats i especials, IPv4 i IPv6.
 * 4. **Connectar a la IP validada**, no tornar a resoldre el nom (reassignació de DNS).
 * 5. Validar **cada** redirecció. Màxim 3.
 * 6. Temps màxim i mida màxima.
 * 7. Llista blanca opcional per variable d'entorn.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Mitigació 6. */
  timeoutMs?: number;
  maxBytes?: number;
  /** Mitigació 5. */
  maxRedirects?: number;
  /** Mitigació 7: amfitrions permesos. Buit vol dir "tots els que passin la resta". */
  allowHosts?: string[];
  /** Injectable per a les proves; per defecte, el DNS de debò. */
  resolve?: (hostname: string) => Promise<string[]>;
  /**
   * La comprovació que decideix on es pot anar. **Per defecte és `resolveSafely`**, o
   * sigui que totes set mitigacions hi són sense fer res.
   *
   * És un paràmetre, i no una variable d'entorn, precisament perquè no hi hagi cap
   * manera d'apagar-la des de fora del codi: una prova pot substituir-la per una de més
   * estreta, però un desplegament no la pot afluixar per accident.
   */
  guard?: (url: URL, options: SafeFetchOptions) => Promise<{ address: string; family: number }>;
}

const DEFAULTS = {
  timeoutMs: 15_000,
  maxBytes: 10 * 1024 * 1024,
  maxRedirects: 3,
};

/** Mitigació 1. `file:`, `gopher:` i `ftp:` no arriben ni a resoldre's. */
export function assertScheme(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError(`L'esquema "${url.protocol}" no es pot fer servir com a origen.`);
  }
}

/**
 * Mitigació 3: la IP és d'un rang que no s'ha de tocar?
 *
 * Es comprova sobre l'adreça **numèrica**, no sobre el nom: `localhost.attacker.com` pot
 * resoldre a `127.0.0.1` i cap comprovació de cadenes ho veuria.
 */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedV4(address);
  if (version === 6) return isBlockedV6(address);
  // El que no és una IP vàlida tampoc no s'hi connecta.
  return true;
}

function isBlockedV4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [a = 0, b = 0] = parts;

  if (a === 0) return true; // «aquesta xarxa»
  if (a === 10) return true; // RFC 1918
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT, RFC 6598
  if (a === 169 && b === 254) return true; // enllaç local, i amb ell el 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 0) return true; // IETF, inclou el 192.0.0.0/24
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 198 && (b === 18 || b === 19)) return true; // proves de rendiment
  if (a >= 224) return true; // multicast i reservat
  return false;
}

function isBlockedV6(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/gu, '');

  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fe80')) return true; // enllaç local
  if (/^f[cd]/u.test(normalized)) return true; // úniques locals, fc00::/7
  if (normalized.startsWith('ff')) return true; // multicast

  /**
   * `::ffff:127.0.0.1` és loopback disfressat d'IPv6. Sense aquesta línia, l'adreça
   * mapada passaria totes les comprovacions d'IPv6 i cap de les d'IPv4.
   */
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(normalized);
  if (mapped?.[1] !== undefined) return isBlockedV4(mapped[1]);

  return false;
}

/** Mitigacions 2, 3, 4 i 7 juntes: què hi ha darrere d'aquesta URL i s'hi pot anar? */
export async function resolveSafely(
  url: URL,
  options: SafeFetchOptions = {},
): Promise<{ address: string; family: number }> {
  assertScheme(url);

  const hostname = url.hostname.replace(/^\[|\]$/gu, '');

  // Mitigació 7.
  if (options.allowHosts !== undefined && options.allowHosts.length > 0) {
    const permès = options.allowHosts.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
    if (!permès) throw new SsrfError(`"${hostname}" no és a la llista d'amfitrions permesos.`);
  }

  // Una IP literal no cal resoldre-la, però sí comprovar-la.
  if (isIP(hostname) !== 0) {
    if (isBlockedAddress(hostname)) throw new SsrfError(`No es pot connectar a ${hostname}.`);
    return { address: hostname, family: isIP(hostname) };
  }

  // Mitigació 2.
  let addresses: string[];
  try {
    addresses =
      options.resolve === undefined
        ? (await lookup(hostname, { all: true })).map((entry) => entry.address)
        : await options.resolve(hostname);
  } catch {
    throw new SsrfError(`No s'ha pogut resoldre "${hostname}".`);
  }

  if (addresses.length === 0) throw new SsrfError(`"${hostname}" no resol a cap adreça.`);

  /**
   * **Totes** les adreces han de passar, no només la primera.
   *
   * Un nom que resol a una pública i una privada és el cas clàssic de reassignació: si
   * només es validés la primera, el sistema podria connectar-se a la segona.
   */
  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      throw new SsrfError(`"${hostname}" resol a ${address}, que és una adreça interna.`);
    }
  }

  const chosen = addresses[0]!;
  return { address: chosen, family: isIP(chosen) };
}

export interface SafeResponse {
  status: number;
  headers: Headers;
  body: string;
  /** L'URL final, després de les redireccions. */
  url: string;
}

/**
 * Una petició a una URL de l'usuari, amb totes les mitigacions.
 *
 * **El verb va en majúscules i no es normalitza.** `fetch` i el client HTTP de la
 * plataforma només normalitzen els verbs estàndard: `method: 'propfind'` viatja en
 * minúscules i el servidor remot respon `501` (docs/07 §1).
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeResponse> {
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError(`"${rawUrl}" no és una URL.`);
  }

  const started = Date.now();

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    // Mitigació 5: cada salt es torna a validar sencer, no només el primer.
    const { address } = await (options.guard ?? resolveSafely)(url, options);

    const restant = timeoutMs - (Date.now() - started);
    if (restant <= 0) throw new SsrfError("S'ha exhaurit el temps màxim.");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), restant);

    let response: Response;
    try {
      response = await fetch(connectionUrl(url, address), {
        // El verb en MAJÚSCULES.
        method: (options.method ?? 'GET').toUpperCase(),
        headers: {
          ...options.headers,
          /**
           * Mitigació 4: es connecta a la **IP validada** i el nom real viatja a `Host`.
           * Tornar a resoldre el nom deixaria una finestra perquè el DNS canviés entre
           * la validació i la connexió, que és exactament la reassignació de DNS.
           */
          Host: url.host,
        },
        ...(options.body === undefined ? {} : { body: options.body }),
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if (controller.signal.aborted) throw new SsrfError("S'ha exhaurit el temps màxim.");
      throw new SsrfError(`No s'ha pogut connectar: ${String(error)}`);
    }
    clearTimeout(timer);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location === null) throw new SsrfError('Una redirecció sense Location.');
      url = new URL(location, url);
      continue;
    }

    return {
      status: response.status,
      headers: response.headers,
      body: await readCapped(response, maxBytes),
      url: url.toString(),
    };
  }

  throw new SsrfError(`Més de ${String(maxRedirects)} redireccions.`);
}

/**
 * L'URL per on es connecta de debò: la IP validada al lloc de l'amfitrió.
 *
 * Amb HTTPS això trencaria la verificació del certificat, que es fa contra el nom. Per a
 * `https` es deixa el nom i s'accepta la finestra —petita— entre validar i connectar:
 * canviar-ho voldria dir un agent de connexió propi amb `servername`, i això és feina
 * per a M14 quan es toqui el desplegament.
 */
function connectionUrl(url: URL, address: string): string {
  if (url.protocol === 'https:') return url.toString();
  const clone = new URL(url.toString());
  clone.hostname = isIP(address) === 6 ? `[${address}]` : address;
  return clone.toString();
}

/** Mitigació 6: es talla en arribar al límit, no després de baixar-ho tot. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new SsrfError('La resposta passa de la mida màxima.');

  const reader = response.body?.getReader();
  if (reader === undefined) return '';

  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new SsrfError('La resposta passa de la mida màxima.');
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString('utf8');
}
