/**
 * El compte propi: perfil, preferències i contrasenya. docs/02 §9 (Perfil), docs/05 §4.
 *
 * `GET /auth/me` viu a `auth.ts` perquè hi comparteix la resolució de capacitats. Aquí
 * hi ha el que **modifica** el compte, que és una altra cosa: llegir qui ets no és el
 * mateix que canviar-te la contrasenya, i la segona revoca sessions.
 */

import type { FastifyInstance } from 'fastify';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { isMailbox } from '../policy/mailbox.js';
import {
  changePassword,
  getProfile,
  getSettings,
  isEventTaskDeleted,
  updateProfile,
  updateSettings,
} from '../services/users.js';
import { avatarFor, profileFor } from '../services/gravatar.js';
import { body, handle, nullable, str } from './handle.js';

/**
 * L'avatar d'una persona.
 *
 * **Passa pel servidor a posta.** Un `<img src="https://gravatar.com/…">` seria una línia
 * menys, però llavors cada navegador de casa parlaria amb Automattic i els arribaria la IP
 * de cadascú a cada càrrega de pàgina. Aquí Gravatar veu una màquina.
 *
 * Demana sessió com la resta de l'API: qui són les persones d'aquesta instància no és
 * públic, i una ruta d'avatars oberta les enumeraria per identificador.
 *
 * Un 404 no és un error, és **"no en té"**: la interfície es queda amb les inicials.
 */
function registerAvatarRoute(app: FastifyInstance): void {
  const db = (): NonNullable<FastifyInstance['connection']> => app.connection!;

  app.get<{ Params: { id: string } }>('/api/v1/users/:id/avatar', async (request, reply) =>
    handle(app, request, reply, async () => {
      const { data, mimeType } = await avatarFor(db().db, request.params.id, app.config.dataDir, {
        enabled: app.config.gravatar,
      });

      void reply
        .code(200)
        .header('content-type', mimeType)
        .header('x-content-type-options', 'nosniff')
        // Una cara no canvia cada minut, i el servidor ja en té la seva pròpia còpia.
        .header('cache-control', 'private, max-age=3600')
        .send(data);
      return undefined;
    }),
  );

  /**
   * El que Gravatar sap de mi.
   *
   * **Només del meu perfil, i només per proposar.** La pantalla d'Ajustos ofereix omplir
   * el que tinc buit; aplicar-ho sol seria canviar-me el nom que he escrit aquí pel que
   * vaig posar fa cinc anys en un altre lloc.
   */
  app.get('/api/v1/me/gravatar', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const profile = await getProfile(db().db, principal.userId);
      if (profile.email === null) return null;
      return profileFor(profile.email, { enabled: app.config.gravatar });
    }),
  );
}

export function registerMeRoutes(app: FastifyInstance): void {
  registerAvatarRoute(app);
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
          inbox_origin: isMailbox(input.inbox_origin) ? input.inbox_origin : undefined,
          event_task_deleted: isEventTaskDeleted(input.event_task_deleted)
            ? input.event_task_deleted
            : undefined,
          collapsed_groups: Array.isArray(input.collapsed_groups)
            ? input.collapsed_groups.filter((v): v is string => typeof v === 'string')
            : undefined,
          week_start: typeof input.week_start === 'string' ? input.week_start : undefined,
          hidden_calendar_ids: Array.isArray(input.hidden_calendar_ids)
            ? input.hidden_calendar_ids.filter((v): v is string => typeof v === 'string')
            : undefined,
          show_calendar_widget:
            typeof input.show_calendar_widget === 'boolean'
              ? input.show_calendar_widget
              : undefined,
          show_overdue_section:
            typeof input.show_overdue_section === 'boolean'
              ? input.show_overdue_section
              : undefined,
          quiet_hours_start: nullable(input, 'quiet_hours_start'),
          quiet_hours_end: nullable(input, 'quiet_hours_end'),
          daily_digest_at: nullable(input, 'daily_digest_at'),
          gravatar: typeof input.gravatar === 'boolean' ? input.gravatar : undefined,
        }),
      );
    }),
  );
}
