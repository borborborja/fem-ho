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
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
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

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

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
  /**
   * **Dins de `192.0.0.0/16` només dos `/24` són reservats**, no el bloc sencer.
   *
   * Aquí hi deia `a === 192 && b === 0`, que bloca `192.0.0.0/16` — seixanta-cinc mil
   * adreces públiques de debò. Es va veure el dia que es va encendre Gravatar: el seu
   * servidor és `192.0.80.239` i la petició no sortia mai, amb un error que semblava una
   * defensa funcionant i era una defensa mal escrita.
   *
   * Els que sí que ho són: `192.0.0.0/24` (assignacions de l'IETF) i `192.0.2.0/24`
   * (TEST-NET-1, documentació).
   */
  if (a === 192 && b === 0) {
    const third = parts[2] ?? 0;
    return third === 0 || third === 2;
  }
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 198 && (b === 18 || b === 19)) return true; // proves de rendiment
  if (a >= 224) return true; // multicast i reservat
  return false;
}

function isBlockedV6(address: string): boolean {
  if (address.includes('%')) return true;
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/u.exec(normalized);
  if (mapped) {
    const hi = Number.parseInt(mapped[1]!, 16);
    const lo = Number.parseInt(mapped[2]!, 16);
    return isBlockedV4([hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'));
  }
  // L'espai global és 2000::/3. Els blocs de transició i documentació en són excepcions.
  return (
    !/^[23][0-9a-f]{3}:/u.test(normalized) || /^(?:2001:(?:0|2|db8):|2002:|3fff:)/u.test(normalized)
  );
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
  /**
   * Els bytes tal com han arribat.
   *
   * Hi són sempre —el lector ja els té a la mà i `body` en surt— i importen quan el que
   * es baixa **no és text**: una imatge passada per `toString('utf8')` i tornada a
   * codificar ja no és la mateixa imatge. Fins ara tot el que es baixava era `.ics` o
   * XML, i per això no calia.
   */
  bytes: Buffer;
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
/**
 * Espera una promesa, però no per sempre.
 *
 * El `lookup` del sistema no accepta cap senyal d'avortament, o sigui que això no el
 * cancel·la: deixa d'esperar-lo. Per a una petició que ja s'ha donat per perduda, és el
 * que cal.
 */
async function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  if (ms <= 0) throw new SsrfError("S'ha exhaurit el temps màxim.");

  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SsrfError(message)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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

  const started = performance.now();
  const remaining = (): number => timeoutMs - (performance.now() - started);
  let method = (options.method ?? 'GET').toUpperCase();
  let body = options.body;
  let headers = new Headers(options.headers);

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    assertScheme(url);
    if (url.username !== '' || url.password !== '') {
      throw new SsrfError("L'URL no pot incloure credencials.");
    }
    /**
     * Mitigació 5: cada salt es torna a validar sencer, no només el primer.
     *
     * **I la resolució entra dins del temps màxim.** Abans el rellotge es posava en
     * marxa aquí i el `lookup` quedava fora: un amfitrió el DNS del qual no respon
     * —no que digui que no existeix, sinó que calla— aturava la crida el temps que
     * el resolutor del sistema volgués. Al planificador, això vol dir un calendari
     * subscrit trencat que **atura el tic sencer**: ni recordatoris, ni federació,
     * ni res, i sense cap error a cap registre. La prova que ho hauria d'haver vist
     * es diu "un origen extern caigut NO impedeix els recordatoris".
     */
    const { address } = await withTimeout(
      (options.guard ?? resolveSafely)(url, options),
      remaining(),
      `No s'ha pogut resoldre "${url.hostname}" a temps.`,
    );
    if (isIP(address) === 0) throw new SsrfError('La resolució no ha retornat cap IP.');

    const restant = remaining();
    if (restant <= 0) throw new SsrfError("S'ha exhaurit el temps màxim.");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), restant);

    try {
      const response = await requestAt(url, address, method, headers, body, controller.signal);
      const status = response.statusCode ?? 0;
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (typeof value === 'string') responseHeaders.set(name, value);
        else value?.forEach((item) => responseHeaders.append(name, item));
      }
      if (REDIRECTS.has(status)) {
        // Importen les capçaleres i prou, i el cos no ha d'endarrerir el salt.
        response.destroy();
        const location = responseHeaders.get('location');
        if (location === null) throw new SsrfError('Una redirecció sense Location.');
        const target = new URL(location, url);
        if (url.protocol === 'https:' && target.protocol !== 'https:') {
          throw new SsrfError('Una redirecció HTTPS ha de conservar HTTPS.');
        }
        if (target.origin !== url.origin) {
          if (body !== undefined || (method !== 'GET' && method !== 'HEAD')) {
            throw new SsrfError('Una petició amb dades no pot canviar d’origen.');
          }
          // L'origen nou pot rebre la consulta pública, mai credencials o capçaleres privades.
          headers = new Headers();
        }
        if (
          (status === 303 && method !== 'HEAD') ||
          ([301, 302].includes(status) && method === 'POST')
        ) {
          method = 'GET';
          body = undefined;
          headers.delete('content-type');
          headers.delete('content-length');
        }
        url = target;
        continue;
      }
      const bytes = await readCapped(response, maxBytes, method !== 'HEAD' && status !== 304);
      return {
        status,
        headers: responseHeaders,
        body: bytes.toString('utf8'),
        bytes,
        url: url.toString(),
      };
    } catch (error) {
      if (controller.signal.aborted) throw new SsrfError("S'ha exhaurit el temps màxim.");
      if (error instanceof SsrfError) throw error;
      throw new SsrfError(`No s'ha pogut connectar: ${String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new SsrfError(`Més de ${String(maxRedirects)} redireccions.`);
}

/** El DNS només decideix la IP. TLS i Host segueixen comprovant l'origen que es demana. */
function requestAt(
  url: URL,
  address: string,
  method: string,
  headers: Headers,
  body: SafeFetchOptions['body'],
  signal: AbortSignal,
): Promise<IncomingMessage> {
  const requestHeaders = Object.fromEntries(headers);
  requestHeaders.host = url.host;
  requestHeaders['accept-encoding'] = 'identity';
  if (body !== undefined) requestHeaders['content-length'] = String(Buffer.byteLength(body));
  const hostname = url.hostname.replace(/^\[|\]$/gu, '');
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        hostname: address,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers: requestHeaders,
        signal,
        agent: false,
        servername: isIP(hostname) === 0 ? hostname : '',
        checkServerIdentity: (_name, certificate) => checkServerIdentity(hostname, certificate),
      },
      resolve,
    );
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

/** Mitigació 6: es talla en arribar al límit, no després de baixar-ho tot. */
async function readCapped(
  response: IncomingMessage,
  maxBytes: number,
  hasBody: boolean,
): Promise<Buffer> {
  const declared = Number(response.headers['content-length'] ?? '0');
  if (hasBody && declared > maxBytes) {
    response.destroy();
    throw new SsrfError('La resposta passa de la mida màxima.');
  }

  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of response) {
    const bytes: Buffer = chunk;
    size += bytes.length;
    if (size > maxBytes) {
      response.destroy();
      throw new SsrfError('La resposta passa de la mida màxima.');
    }
    chunks.push(bytes);
  }

  return Buffer.concat(chunks, size);
}
