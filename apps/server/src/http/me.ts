/**
 * El compte propi: perfil, preferències i contrasenya. docs/02 §9 (Perfil), docs/05 §4.
 *
 * `GET /auth/me` viu a `auth.ts` perquè hi comparteix la resolució de capacitats. Aquí
 * hi ha el que **modifica** el compte, que és una altra cosa: llegir qui ets no és el
 * mateix que canviar-te la contrasenya, i la segona revoca sessions.
 */

import type { FastifyInstance } from 'fastify';
import { auditedTransaction } from '../audit/audited-transaction.js';
import {
  changePassword,
  getProfile,
  getSettings,
  updateProfile,
  updateSettings,
} from '../services/users.js';
import { body, handle, nullable, str } from './handle.js';

export function registerMeRoutes(app: FastifyInstance): void {
  const db = (): NonNullable<FastifyInstance['connection']> => app.connection!;

  app.patch('/api/v1/auth/me', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      return auditedTransaction(db().db, principal, (ctx) =>
        updateProfile(ctx, principal, {
          name: str(input.name),
          timezone: str(input.timezone),
          locale: str(input.locale),
          theme: str(input.theme),
          accent: str(input.accent),
          avatar_color: nullable(input, 'avatar_color'),
        }),
      );
    }),
  );

  app.post('/api/v1/auth/password', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      return auditedTransaction(db().db, principal, (ctx) =>
        changePassword(ctx, principal, {
          current: str(input.current_password),
          next: str(input.new_password),
        }),
      );
    }),
  );

  /**
   * Les preferències, a part del perfil.
   *
   * Van separades perquè es toquen amb freqüències molt diferents: el nom es canvia un
   * cop, i `done_cleared_at` cada vegada que algú prem "netejar" a la columna Fet. Un
   * sol `PATCH` per a totes dues coses faria que netejar la columna passés pel camí que
   * valida fusos horaris.
   */
  app.get('/api/v1/auth/settings', async (request, reply) =>
    handle(app, request, reply, async (principal) => ({
      profile: await getProfile(db().db, principal.userId),
      settings: await getSettings(db().db, principal.userId),
    })),
  );

  app.patch('/api/v1/auth/settings', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      return auditedTransaction(db().db, principal, (ctx) =>
        updateSettings(ctx, principal, {
          done_cleared_at: nullable(input, 'done_cleared_at'),
          inbox_position: str(input.inbox_position),
          inbox_show_overdue:
            typeof input.inbox_show_overdue === 'boolean' ? input.inbox_show_overdue : undefined,
          collapsed_groups: Array.isArray(input.collapsed_groups)
            ? input.collapsed_groups.filter((v): v is string => typeof v === 'string')
            : undefined,
          hidden_calendar_ids: Array.isArray(input.hidden_calendar_ids)
            ? input.hidden_calendar_ids.filter((v): v is string => typeof v === 'string')
            : undefined,
          show_calendar_widget:
            typeof input.show_calendar_widget === 'boolean' ? input.show_calendar_widget : undefined,
          show_overdue_section:
            typeof input.show_overdue_section === 'boolean' ? input.show_overdue_section : undefined,
          quiet_hours_start: nullable(input, 'quiet_hours_start'),
          quiet_hours_end: nullable(input, 'quiet_hours_end'),
          daily_digest_at: nullable(input, 'daily_digest_at'),
        }),
      );
    }),
  );
}
