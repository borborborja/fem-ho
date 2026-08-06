/**
 * El punt d'entrada del camí DAV.
 *
 * Engega el servidor CalDAV en un port propi dins del **mateix procés** que l'API
 * (D1 · docs/07 §1): ctag i sync-token surten del mateix `sync_seq` que s'incrementa
 * dins de la transacció d'escriptura, i un segon procés hauria de compartir-la.
 */

import type { Server } from 'node:http';
import type { Connection } from '../db/connection.js';
import { get, propfind, proppatch, reportHandler } from './handlers.js';
import { createDavServer } from './server.js';
import { del, put } from './write.js';

export { createDavServer } from './server.js';
export { ALLOWED_METHODS, DAV_COMPLIANCE } from './server.js';

export function buildDavServer(connection: Connection): Server {
  return createDavServer({
    connection,
    handlers: {
      PROPFIND: propfind,
      PROPPATCH: proppatch,
      REPORT: reportHandler,
      GET: get,
      HEAD: get,
      PUT: put,
      DELETE: del,
    },
  });
}
