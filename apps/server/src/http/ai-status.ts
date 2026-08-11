/**
 * `GET /api/v1/ai/status`.
 *
 * **La frase honesta és tot el sentit d'aquest fitxer**: «configurada» vol dir que hi ha
 * credencials, no que res les faci servir encara. `docs/09` diu que Fem-ho no té motor
 * d'IA propi i que la intel·ligència és sempre externa; el que existeix avui és el terreny
 * (P10 a `docs/14`), i el risc real d'un terreny és que sembli la funció.
 *
 * **Què no surt d'aquí, i per què cadascuna:**
 *
 * - **La clau, ni emmascarada.** Una màscara filtra la longitud i el prefix, que és
 *   exactament el que serveix per confirmar una clau robada.
 * - **L'URL sencera.** Només l'amfitrió: una URL pot portar un testimoni a la cadena de
 *   consulta, i d'aquí aniria a la pantalla, als registres i a una captura de pantalla.
 */

import type { FastifyInstance } from 'fastify';
import { handle } from './handle.js';

export interface AiStatus {
  configured: boolean;
  provider: string;
  model: string | null;
  base_url_host: string | null;
  max_input_tokens: number;
  warnings: string[];
}

/** L'amfitrió d'una URL, o `null` si no se'n pot treure. */
function hostOf(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') return null;
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}

export function registerAiStatusRoutes(app: FastifyInstance): void {
  app.get('/api/v1/ai/status', async (request, reply) =>
    handle(app, request, reply, async (): Promise<AiStatus> => {
      const ai = app.config.ai;
      const configured = ai.provider !== 'none' && ai.provider !== '';

      const warnings: string[] = [];
      if (configured) {
        /**
         * L'avís que la pantalla ha de poder ensenyar sense inventar-se'l: **hi ha
         * credencials i encara no hi ha res que les faci servir**. Si això no es digués,
         * el que passaria és que algú configuraria el proveïdor i esperaria un
         * comportament que no arribarà, i ho llegiria com una avaria.
         */
        warnings.push('ai.status.configuredButUnused');
      }
      if (!configured && (ai.apiKey !== undefined || ai.model !== undefined)) {
        // Una clau o un model sense proveïdor: no és un error, però algú s'ho pensava.
        warnings.push('ai.status.credentialsWithoutProvider');
      }

      return {
        configured,
        provider: configured ? ai.provider : 'none',
        model: ai.model ?? null,
        base_url_host: hostOf(ai.baseUrl),
        max_input_tokens: ai.maxInputTokens,
        warnings,
      };
    }),
  );
}
