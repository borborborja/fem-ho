/**
 * L'embolcall comú dels handlers.
 *
 * Els handlers són prims a posta: **la decisió viu a la capa de servei** (regla 8). Aquí
 * només es tradueix HTTP a principal, es crida el servei, i es tradueix el resultat o
 * l'error de tornada a `application/problem+json`.
 *
 * Vivia dins de `tasks.ts` mentre només hi havia un fitxer de rutes. Amb sis, copiar-lo
 * seria garantir que un dia un dels sis tradueixi els errors d'una altra manera i que
 * una ruta comenci a tornar 500 on les altres tornen 403.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PolicyError, unauthenticated } from '../policy/errors.js';
import type { Principal } from '../policy/principal.js';
import { principalOf } from './auth.js';

export async function handle<T>(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  work: (principal: Principal) => Promise<T>,
): Promise<T | undefined> {
  try {
    if (app.connection === undefined) throw unauthenticated('La instància no té base de dades.');
    const principal = await principalOf(app, request);
    return await work(principal);
  } catch (error) {
    if (error instanceof PolicyError) {
      void reply.code(error.status).type('application/problem+json').send(error.toProblem(request.url));
      return undefined;
    }
    throw error;
  }
}

/** El cos com a objecte, sense que cada handler hagi de repetir la conversió. */
export function body(request: FastifyRequest): Record<string, unknown> {
  return (request.body ?? {}) as Record<string, unknown>;
}

/** La consulta com a objecte. */
export function query(request: FastifyRequest): Record<string, unknown> {
  return request.query as Record<string, unknown>;
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function bool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  // Ve d'una query string: `?include_overdue=true` arriba com a cadena.
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Un camp que distingeix "no el toquis" de "buida'l".
 *
 * `undefined` si la clau no hi és; `null` si hi és amb valor nul. Sense això, cap `PATCH`
 * pot esborrar una data: enviar `null` i no enviar res arribarien igual.
 */
export function nullable(source: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in source)) return undefined;
  const value = source[key];
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

export function ids(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined;
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return parts.length > 0 ? parts : undefined;
}

/** La data d'avui a la zona demanada, com a `YYYY-MM-DD`. */
export function today(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
