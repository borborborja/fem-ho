/**
 * El servidor CalDAV, sobre `node:http` pelat (D1 · docs/07 §1).
 *
 * Node ja accepta tots els verbs DAV sense configuració: `PROPFIND`, `PROPPATCH`,
 * `REPORT`, `MKCALENDAR`, `MKCOL`, `COPY`, `MOVE`, `ACL`, `LOCK` i `UNLOCK` són a la
 * seva taula de mètodes. Un framework, aquí, només hi posa obstacles.
 *
 * **Va al mateix procés que l'API**, en un port propi. El motiu és el `sync_seq`: ctag i
 * sync-token surten del mateix comptador que s'incrementa dins de la transacció
 * d'escriptura, i un segon escriptor hauria de compartir aquella transacció.
 *
 * **No es registra cap listener de `'checkContinue'`.** Registrar-lo sense cridar
 * `res.writeContinue()` penja tots els `PUT` d'Apple, que envien `Expect: 100-continue`.
 * Sense listener, Node respon el `100 Continue` automàticament.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Connection } from '../db/connection.js';
import { parsePath, type DavResource } from './paths.js';
import { authenticate, type DavPrincipal } from './auth.js';

/** Els verbs que s'anuncien a `Allow` (docs/07 §3). */
export const ALLOWED_METHODS =
  'OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR, MKCOL, COPY, MOVE';

/** El que s'anuncia a `DAV:`. Sense això, DAVx⁵ no considera el servidor un CalDAV. */
export const DAV_COMPLIANCE = '1, 2, 3, calendar-access, addressbook';

/** Un cos més gran que això no és un PROPFIND: és un intent d'esgotar la memòria. */
const MAX_BODY = 10 * 1024 * 1024;

export interface DavContext {
  connection: Connection;
  request: IncomingMessage;
  response: ServerResponse;
  principal: DavPrincipal;
  resource: DavResource;
  body: string;
  path: string;
}

export type DavHandler = (context: DavContext) => Promise<void>;

export interface DavServerOptions {
  connection: Connection;
  /** El domini del `WWW-Authenticate`. Surt a la finestra de credencials del client. */
  realm?: string;
  handlers: Record<string, DavHandler>;
}

export function createDavServer(options: DavServerOptions): Server {
  const realm = options.realm ?? 'Fem-ho';

  // Cap `server.on('checkContinue', …)`: veure la capçalera d'aquest fitxer.
  return createServer((request, response) => {
    void handle(request, response, options, realm).catch((error: unknown) => {
      // El detall no surt a la resposta —un client no n'ha de fer res— però sí al
      // registre: un 500 mut al camí DAV és impossible de diagnosticar des de fora.
      process.emitWarning(`DAV ${request.method ?? '?'} ${request.url ?? '?'}: ${String(error)}`);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: DavServerOptions,
  realm: string,
): Promise<void> {
  const path = request.url ?? '/';
  const method = (request.method ?? 'GET').toUpperCase();
  const resource = parsePath(path);

  /**
   * `OPTIONS` es respon **sense autenticar**. Els clients el fan servir per descobrir si
   * hi ha un CalDAV a l'altra banda abans de tenir credencials, i demanar-les aquí fa
   * que alguns es rendeixin abans de començar.
   */
  if (method === 'OPTIONS') {
    response.writeHead(200, {
      DAV: DAV_COMPLIANCE,
      Allow: ALLOWED_METHODS,
      'Content-Length': '0',
    });
    response.end();
    return;
  }

  if (resource.type === 'well-known') {
    // 301 i no 302: la ubicació del principal no canvia, i els clients se la guarden.
    response.writeHead(301, { Location: `${originOf(request)}/dav/` });
    response.end();
    return;
  }

  const principal = await authenticate(options.connection, request);
  if (principal === undefined) {
    response.writeHead(401, {
      'WWW-Authenticate': `Basic realm="${realm}", charset="UTF-8"`,
      'Content-Length': '0',
    });
    response.end();
    return;
  }

  const handler = options.handlers[method];
  if (handler === undefined) {
    response.writeHead(405, { Allow: ALLOWED_METHODS, 'Content-Length': '0' });
    response.end();
    return;
  }

  let body: string;
  try {
    body = await readBody(request);
  } catch {
    response.writeHead(413, { 'Content-Length': '0' });
    response.end();
    return;
  }

  await handler({
    connection: options.connection,
    request,
    response,
    principal,
    resource,
    body,
    path,
  });
}

function originOf(request: IncomingMessage): string {
  // Darrere d'un proxy invers l'esquema real ve a `X-Forwarded-Proto`; si no hi és,
  // s'assumeix el que hi ha. Es fa servir només per al `Location` de `.well-known`.
  const forwarded = request.headers['x-forwarded-proto'];
  const scheme = typeof forwarded === 'string' ? (forwarded.split(',')[0] ?? 'http') : 'http';
  const host = request.headers.host ?? 'localhost';
  return `${scheme.trim()}://${host}`;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        request.destroy();
        reject(new Error('El cos passa del límit.'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/** Escriu una resposta `207 Multi-Status`, que és el 99% del que respon un CalDAV. */
export function multiStatus(response: ServerResponse, xml: string): void {
  const body = Buffer.from(xml, 'utf8');
  response.writeHead(207, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Content-Length': String(body.length),
    DAV: DAV_COMPLIANCE,
  });
  response.end(body);
}

export function plain(response: ServerResponse, status: number, text = ''): void {
  const body = Buffer.from(text, 'utf8');
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': String(body.length),
  });
  response.end(body);
}
