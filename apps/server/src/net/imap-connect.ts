/**
 * Connectar-se a un servidor IMAP sense que això sigui una porta cap a la xarxa de casa.
 *
 * **PER QUÈ NO ES REUTILITZA `safeFetch`, I QUÈ SÍ QUE ES REUTILITZA**
 * -------------------------------------------------------------------
 * `safeFetch` està soldat a `fetch` i `assertScheme` només accepta `http:` i `https:`: no
 * hi ha manera de fer-hi passar una connexió IMAP. El que sí que es reutilitza és **la
 * part que costa d'escriure bé i que ja porta les cicatrius pagades**: `isBlockedAddress`,
 * amb els seus rangs i amb la lliçó del `192.0.0.0/16` que un dia va bloquejar seixanta-cinc
 * mil adreces públiques de debò.
 *
 * Copiar la llista de rangs aquí hauria estat el camí curt, i el dia que se n'arreglés un
 * només s'arreglaria en un dels dos llocs.
 *
 * **AQUEST CAMÍ ACABA MÉS ESTRICTE QUE L'HTTP, I NO PER CASUALITAT**
 * ------------------------------------------------------------------
 * Tres coses que aquí es poden fer i amb HTTPS no:
 *
 * 1. **Es connecta a la IP validada**, amb `servername` per al TLS. Amb `fetch` no es pot:
 *    s'ha de donar el nom i tornar-hi a confiar, que és la finestra de reassignació de DNS
 *    que `safeFetch` documenta i no pot tancar. Aquí es tanca.
 * 2. **Només els ports 993 i 143.** Sense això, un «compte de correu» apuntant a
 *    `localhost:6379` és una manera de fer que el servidor parli amb el Redis de la casa.
 *    (El port es valida també al servei, perquè és una regla de producte i no de xarxa.)
 * 3. **TLS obligatori i mai `rejectUnauthorized: false`.** Ni darrere d'una casella.
 *
 * El cas simpàtic del tercer punt és real: un Dovecot de casa amb certificat propi, i algú
 * que només vol que funcioni. La resposta és **afegir la CA a la instància**, no un
 * interruptor que desactiva la verificació —perquè l'interruptor l'acabaria activant qui
 * no té cap certificat propi, i llavors el TLS ja no protegeix de res—. Ho vigila
 * `mail-invariants`.
 */

import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { ImapFlow, type ListResponse } from 'imapflow';
import { SsrfError, isBlockedAddress } from '../dav/fetch-safe.js';

/** Els dos ports d'IMAP. No n'hi ha cap més, i per tant no se n'admet cap més. */
export const IMAP_PORTS = new Set([993, 143]);

export interface ImapTarget {
  host: string;
  port: number;
  security: 'tls' | 'starttls';
  username: string;
  password: string;
}

export interface ImapConnectOptions {
  /** `FEMHO_MAIL_ALLOW_HOSTS`, si la instància n'ha posat. */
  allowHosts?: string[] | undefined;
  /** Injectable per a les proves; per defecte, el DNS de debò. */
  resolve?: ((hostname: string) => Promise<string[]>) | undefined;
  timeoutMs?: number | undefined;
}

/**
 * A quina adreça es pot connectar aquest amfitrió, si és que se'n pot.
 *
 * Exportada perquè la prova pugui exercitar-la sense obrir cap connexió: la part que ha de
 * ser certa és **quines adreces es rebutgen**, i això no necessita cap servidor.
 */
export async function resolveImapHost(
  host: string,
  port: number,
  options: ImapConnectOptions = {},
): Promise<string> {
  if (!IMAP_PORTS.has(port)) {
    throw new SsrfError(`El port ${String(port)} no és un port d'IMAP.`);
  }

  const hostname = host.trim().replace(/^\[|\]$/gu, '').toLowerCase();
  if (hostname === '') throw new SsrfError("Falta l'amfitrió.");

  const { allowHosts } = options;
  if (allowHosts !== undefined && allowHosts.length > 0) {
    const permès = allowHosts.some((h) => hostname === h || hostname.endsWith(`.${h}`));
    if (!permès) throw new SsrfError(`"${hostname}" no és a la llista d'amfitrions permesos.`);
  }

  if (isIP(hostname) !== 0) {
    if (isBlockedAddress(hostname)) throw new SsrfError(`No es pot connectar a ${hostname}.`);
    return hostname;
  }

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
   * **Totes** han de passar, no només la primera: un nom que resol a una pública i una
   * privada és el cas clàssic de reassignació. Mateixa regla que a `resolveSafely`.
   */
  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      throw new SsrfError(`"${hostname}" resol a ${address}, que és una adreça interna.`);
    }
  }
  return addresses[0]!;
}

/**
 * Les opcions amb què s'obre una connexió, calculades a part.
 *
 * Estan separades de l'obertura perquè **es puguin comprovar sense xarxa**: que
 * `rejectUnauthorized` no s'apagui mai i que el `servername` sigui el nom i no la IP són
 * exactament el gènere de coses que una prova ha de poder llegir.
 */
export function imapOptions(
  target: ImapTarget,
  address: string,
  timeoutMs: number,
): ConstructorParameters<typeof ImapFlow>[0] {
  return {
    // La **IP validada**, no el nom: entre la comprovació i la connexió no hi ha una
    // segona resolució de DNS que pugui donar una altra resposta.
    host: address,
    port: target.port,
    // `secure: true` és IMAPS directe; amb `false`, imapflow puja a TLS amb STARTTLS.
    secure: target.security === 'tls',
    // I el certificat es valida contra **el nom**, que és el que el servidor presenta.
    servername: target.host,
    auth: { user: target.username, pass: target.password },
    tls: {
      servername: target.host,
      // No hi ha cap camí de codi que ho posi a `false`. Explícit perquè es vegi.
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    },
    // No es vol una connexió que es quedi esperant correu: aquí es ve a fer una feina.
    disableAutoIdle: true,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
    logger: false,
  };
}

export interface ImapProbe {
  ok: boolean;
  error: string | null;
  folders: string[];
  delimiter: string | null;
}

const DEFAULT_TIMEOUT = 15_000;

/**
 * Provar la connexió: entrar, llistar carpetes i sortir. **No desa res i no toca cap
 * correu.**
 *
 * Torna un resultat i **no llança** quan el que falla és el servidor de l'altra banda: unes
 * credencials dolentes no són un error de la nostra API, són la resposta a la pregunta que
 * s'ha fet. El que sí que llança és l'`SsrfError`, perquè això no és «no ha anat bé»: és
 * «no es pot demanar».
 */
export async function probeImap(
  target: ImapTarget,
  options: ImapConnectOptions = {},
): Promise<ImapProbe> {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const address = await resolveImapHost(target.host, target.port, options);

  const client = new ImapFlow(imapOptions(target, address, timeout));
  try {
    await client.connect();
    const boxes: ListResponse[] = await client.list();
    return {
      ok: true,
      error: null,
      folders: boxes.map((box) => box.path).sort(),
      delimiter: boxes[0]?.delimiter ?? null,
    };
  } catch (error) {
    return { ok: false, error: readableError(error), folders: [], delimiter: null };
  } finally {
    // `logout` és el tancament net; si ja ha petat abans, no ha de tapar l'error de dalt.
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

/**
 * El missatge que veurà una persona.
 *
 * **No es torna la resposta crua del servidor.** Una resposta d'IMAP pot dur el nom
 * d'usuari i fins i tot part de la comanda, i això acaba en una captura de pantalla en un
 * xat de suport. El que es dona és de quina mena és el problema, que és el que serveix per
 * arreglar-lo.
 */
export function readableError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string } | null)?.code ?? '';

  if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|auth/iu.test(raw)) {
    return "L'usuari o la contrasenya no són correctes.";
  }
  if (code === 'ENOTFOUND' || /getaddrinfo/iu.test(raw)) return "No s'ha trobat el servidor.";
  if (code === 'ECONNREFUSED') return 'El servidor ha refusat la connexió en aquest port.';
  if (code === 'ETIMEDOUT' || /timeout/iu.test(raw)) return 'El servidor no ha contestat a temps.';
  if (/certificate|self.signed|CERT_/iu.test(raw)) {
    // I es diu la sortida bona, que no és desactivar la verificació.
    return "El certificat del servidor no es pot verificar. Cal afegir-ne la CA a la instància.";
  }
  return "No s'ha pogut connectar amb el servidor de correu.";
}
