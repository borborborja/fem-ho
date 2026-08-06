/**
 * El punt final MCP.
 *
 * **Un sol `POST /mcp` sense estat de sessió** (docs/08 §1): cada petició és
 * autodescriptiva i construeix el seu servidor amb el token ja resolt. És la forma de la
 * revisió de mitjan 2026, i per a una app autoallotjada encaixa gairebé un a un amb la
 * capa de servei que ja existeix per a l'API REST.
 *
 * L'SDK oficial serveix **les dues eres** des del mateix transport: amb
 * `sessionIdGenerator: undefined` va sense sessió, i amb un generador manté l'era antiga.
 * Això respon la pregunta que `docs/08` §1 deixava oberta.
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { buildMcpServer } from '../mcp/server.js';
import { PolicyError } from '../policy/errors.js';
import type { Principal } from '../policy/principal.js';
import { principalOf } from './auth.js';

/**
 * El domini del repte. Surt al `WWW-Authenticate` i és el que el client ensenya a
 * l'usuari quan li demana la clau.
 */
const REALM = 'Fem-ho MCP';

export function registerMcpRoutes(app: FastifyInstance): void {
  /**
   * `POST /mcp` i no `/api/v1/mcp`: el camí MCP no és l'API REST versionada. Barrejar-los
   * faria pensar que una versió nova de l'API canvia el protocol, que són coses
   * independents.
   */
  app.post('/mcp', async (request, reply) => {
    const principal = await authenticate(app, request, reply);
    if (principal === undefined) return;

    const connection = app.connection;
    if (connection === undefined) {
      void reply.code(503).send({ error: 'The instance has no database.' });
      return;
    }

    const server = buildMcpServer({
      connection,
      principal,
      version: app.config.version,
    });

    /**
     * Sense estat: cap sessió al servidor, cap identificador a les capçaleres.
     *
     * L'`as never` és per `exactOptionalPropertyTypes`: l'SDK declara
     * `sessionIdGenerator?: () => string` i distingeix "absent" de "present i
     * `undefined`", però el seu codi comprova `=== undefined` per triar el mode sense
     * estat. Ometre la propietat donaria el mode amb sessió, que no és el que volem.
     */
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    } as never);

    // Fastify ja ha llegit i parsejat el cos; el transport el vol com a tercer argument
    // perquè no el pugui tornar a llegir del flux.
    reply.hijack();
    try {
      await server.connect(transport as never);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } finally {
      // El transport i el servidor són d'aquesta petició i prou: tancar-los és el que fa
      // que "sense estat" ho sigui de debò i no una fuita d'objectes per petició.
      reply.raw.on('close', () => {
        void transport.close();
        void server.close();
      });
    }
  });

  /**
   * `GET /mcp` amb `405`.
   *
   * A l'era antiga aquest camí obria un flux d'esdeveniments. Sense sessions no hi ha res
   * a obrir, i un `404` faria pensar que el punt final no existeix; un `405` amb `Allow`
   * diu exactament què passa.
   */
  app.get('/mcp', async (_request, reply) => {
    void reply.code(405).header('Allow', 'POST').send({
      error: 'Aquest servidor MCP no manté sessions: totes les crides van per POST.',
    });
  });
}

/**
 * Resol el token.
 *
 * **Quan falta o no val, `401` amb `WWW-Authenticate`.** Si en comptes d'això es
 * respongués `200` amb un resultat d'error dient "cal iniciar sessió", el client li
 * donaria aquest text al model com si fos el resultat de l'eina i **l'usuari no veuria
 * mai cap botó de connectar**. És l'error que fa que un servidor MCP sembli trencat
 * sense donar cap pista (docs/08 §2).
 */
async function authenticate(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Principal | undefined> {
  try {
    // El canal el declara la ruta, no la petició: aquí se sap segur que és MCP.
    const principal = await principalOf(app, request, 'mcp');

    /**
     * El token que arriba és **per a Fem-ho**. No es reenvia mai a un CalDAV extern ni a
     * cap altre servei: reenviar-lo és el problema del diputat confús i l'especificació
     * ho prohibeix explícitament (docs/08 §2). El principal que surt d'aquí no porta el
     * token, només el que pot fer, i això és el que ho fa impossible per construcció.
     */
    return principal;
  } catch (error) {
    if (error instanceof PolicyError && error.status === 401) {
      void reply
        .code(401)
        .header('WWW-Authenticate', `Bearer realm="${REALM}"`)
        .type('application/problem+json')
        .send(error.toProblem(request.url));
      return undefined;
    }

    if (error instanceof PolicyError) {
      // Un problema de permisos també és HTTP, mai un resultat de tool amb error: un
      // agent que rebés un 200 amb "no pots" reintentaria fins a esgotar el límit.
      void reply
        .code(error.status)
        .type('application/problem+json')
        .send(error.toProblem(request.url));
      return undefined;
    }

    throw error;
  }
}
