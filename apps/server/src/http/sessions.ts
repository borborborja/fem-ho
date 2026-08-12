/**
 * Les rutes del Registre.
 *
 * **El fus és el de qui pregunta.** El Registre s'agrupa per dies, i un dia és una cosa
 * local: un servidor a UTC i una casa a Madrid no coincideixen dues hores cada nit. Per això
 * cada crida llegeix el perfil, com fan la bústia i el tauler (docs/01 §8).
 */

import type { FastifyInstance } from 'fastify';
import { auditedTransaction } from '../audit/audited-transaction.js';
import {
  sessionReport,
  type SessionEntry,
  type SessionFilters,
} from '../services/session-report.js';
import { createSession, deleteSession, updateSession } from '../services/sessions.js';
import { getProfile } from '../services/users.js';
import { body, handle, ids, query, str } from './handle.js';

export function registerSessionRoutes(app: FastifyInstance): void {
  const db = (): NonNullable<FastifyInstance['connection']> => app.connection!;

  const filtersOf = async (request: Parameters<typeof query>[0], userId: string) => {
    const q = query(request);
    const profile = await getProfile(db().db, userId);
    return {
      from: str(q.from),
      to: str(q.to),
      scopeIds: ids(q.scope_ids),
      projectId: str(q.project_id),
      userId: str(q.user_id),
      taskTypeId: str(q.task_type_id),
      search: str(q.search),
      timezone: profile.timezone,
    } satisfies SessionFilters;
  };

  app.get('/api/v1/sessions', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      sessionReport(db().db, principal, await filtersOf(request, principal.userId)),
    ),
  );

  /**
   * **El CSV, amb el BOM.**
   *
   * Sense els tres bytes del principi, l'Excel obre el fitxer en la codificació del sistema i
   * els accents es trenquen; amb ells, s'obre bé a tot arreu. És lleig i és el que cal, i
   * per això va escrit aquí i no s'ha de recordar cada vegada.
   */
  app.get('/api/v1/sessions/export.csv', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const report = await sessionReport(
        db().db,
        principal,
        await filtersOf(request, principal.userId),
      );
      const profile = await getProfile(db().db, principal.userId);

      void reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="registre.csv"')
        .send(`${BOM}${toCsv(report.data, profile.timezone)}`);
      return undefined;
    }),
  );

  app.post('/api/v1/sessions', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      const created = await auditedTransaction(db().db, principal, (ctx) =>
        createSession(ctx, principal, {
          task_id: String(input.task_id ?? ''),
          started_at: String(input.started_at ?? ''),
          ended_at: String(input.ended_at ?? ''),
          note: str(input.note),
          user_id: str(input.user_id),
        }),
      );
      void reply.code(201);
      return created;
    }),
  );

  app.patch<{ Params: { id: string } }>('/api/v1/sessions/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      return auditedTransaction(db().db, principal, (ctx) =>
        updateSession(ctx, principal, request.params.id, {
          ...(str(input.started_at) === undefined ? {} : { started_at: String(input.started_at) }),
          ...(str(input.ended_at) === undefined ? {} : { ended_at: String(input.ended_at) }),
          ...(str(input.task_id) === undefined ? {} : { task_id: String(input.task_id) }),
          ...(input.note === undefined
            ? {}
            : { note: input.note === null ? null : String(input.note) }),
        }),
      );
    }),
  );

  app.delete<{ Params: { id: string } }>('/api/v1/sessions/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      await auditedTransaction(db().db, principal, (ctx) =>
        deleteSession(ctx, principal, request.params.id),
      );
      void reply.code(204).send();
      return undefined;
    }),
  );
}

/**
 * Els tres bytes que fan que l'Excel obri el fitxer en UTF-8.
 *
 * S'escriu amb el codi i no amb el caràcter perquè un caràcter invisible dins d'una cadena
 * és exactament la mena de cosa que algú esborra sense saber què esborrava.
 */
const BOM = '\uFEFF';

/**
 * Les mateixes columnes que l'eina que això substitueix, perquè els fulls de càlcul que ja
 * existeixen segueixin funcionant: `Data,Hora,Projecte,Tasca,Tipologia,Persona,Minuts`.
 *
 * Salts `CRLF` i escapat RFC 4180: una tasca amb una coma al títol trencaria la columna, i
 * una amb cometes en trencaria dues.
 */
export function toCsv(entries: SessionEntry[], timezone: string): string {
  const files = [['Data', 'Hora', 'Projecte', 'Tasca', 'Tipologia', 'Persona', 'Minuts']];

  const dia = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const hora = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  for (const entry of entries) {
    const at = new Date(entry.started_at);
    files.push([
      dia.format(at),
      hora.format(at),
      entry.project_name ?? '',
      entry.task_title,
      entry.task_type_name ?? '',
      entry.user_name ?? '',
      String(entry.minutes),
    ]);
  }

  return `${files.map((fila) => fila.map(escape).join(',')).join('\r\n')}\r\n`;
}

function escape(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
