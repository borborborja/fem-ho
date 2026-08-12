/**
 * La marca de la instància: el nom i el logo.
 *
 * Una eina autoallotjada que es desplega dins d'una empresa s'hi ha de poder presentar. El
 * nom ja existia (`FEMHO_INSTANCE_NAME`, publicat a `/info`) i **la barra l'ignorava**; el
 * logo no hi era.
 *
 * **LES DUES PORTES, I QUINA MANA**
 * ---------------------------------
 * `FEMHO_LOGO_URL` posat → mana, i Ajustos ho diu sense deixar-ho tocar. Buit → s'hi puja
 * des d'Ajustos ▸ Admin. Ho vol qui desplega amb `compose.yaml` immutable **i** qui vol
 * canviar-lo sense entrar al servidor, i són dues persones diferents.
 *
 * **PER QUÈ NOMÉS TRES FORMATS, I PER QUÈ L'SVG VA AMB CADENA**
 * -------------------------------------------------------------
 * Un SVG és XML i pot portar `<script>`. Servit al mateix origen que l'app, un logo pujat
 * per un administrador seria codi executant-se amb la sessió de tothom. Es serveix amb
 * `Content-Security-Policy: sandbox` —que li treu els scripts i el mateix origen— i amb el
 * tipus que decidim nosaltres, mai el que digui qui el puja.
 *
 * El cos va cru, com als adjunts, i pel mateix motiu: un sol fitxer per petició no
 * necessita analitzar `multipart`.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { hasCapability } from '../policy/principal.js';
import { PolicyError, missingCapability } from '../policy/errors.js';
import { handle, query, str } from './handle.js';

/** El que s'accepta, i amb quina extensió es desa. Res més entra. */
const TIPUS: Record<string, string> = {
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Mig mega.
 *
 * Un logo de barra es veu a 24 píxels d'alt. Amb més que això el que hi ha no és un logo
 * sinó una foto, i la serviria a cada càrrega de cada pantalla de tothom.
 */
const MAX_BYTES = 512 * 1024;

function brandDir(app: FastifyInstance): string {
  return join(app.config.dataDir, 'brand');
}

/** El fitxer que hi ha, si n'hi ha. Es busca per extensió: només n'hi pot haver un. */
export function currentLogo(app: FastifyInstance): { path: string; type: string } | null {
  const dir = brandDir(app);
  let noms: string[];
  try {
    noms = readdirSync(dir);
  } catch {
    return null;
  }
  for (const [type, ext] of Object.entries(TIPUS)) {
    const nom = `logo.${ext}`;
    if (noms.includes(nom)) return { path: join(dir, nom), type };
  }
  return null;
}

/**
 * L'adreça del logo per a `/info`, o `null`.
 *
 * `FEMHO_LOGO_URL` mana i es torna tal com és —pot apuntar a un CDN o a un fitxer que
 * serveixi un proxy—; si no, la que serveix aquest mòdul. Qui pinta la marca no ha de
 * saber d'on surt.
 */
export function logoUrl(app: FastifyInstance): string | null {
  if (app.config.logoUrl !== undefined) return app.config.logoUrl;
  return currentLogo(app) === null ? null : '/brand/logo';
}

export function registerBrandingRoutes(app: FastifyInstance): void {
  app.addContentTypeParser(
    ['image/svg+xml', 'image/png', 'image/webp'],
    { parseAs: 'buffer' },
    (_request, body, done) => {
      done(null, body);
    },
  );

  /**
   * El logo, públic.
   *
   * Sense autenticar a posta: surt a la pantalla de login i a la pàgina d'un enllaç
   * compartit, que són **les dues pantalles on encara no hi ha sessió**.
   */
  app.get('/brand/logo', async (_request, reply) => {
    const logo = currentLogo(app);
    if (logo === null) {
      void reply.code(404).send();
      return;
    }
    void reply
      .header('content-type', logo.type)
      // La cadena que fa que un SVG pujat no pugui executar res ni parlar amb l'origen.
      .header('content-security-policy', 'sandbox')
      .header('content-disposition', 'inline')
      // Poc, i no un any: el logo canvia quan algú el canvia, i no porta hash al nom.
      .header('cache-control', 'public, max-age=300')
      .send(readFileSync(logo.path));
  });

  app.post('/api/v1/admin/branding/logo', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      if (!hasCapability(principal, 'instance:manage')) throw missingCapability('instance:manage');

      if (app.config.logoUrl !== undefined) {
        throw new PolicyError(
          'logo-fixed',
          'Logo is fixed',
          422,
          'This instance sets FEMHO_LOGO_URL, so the logo cannot be uploaded here.',
        );
      }

      const type = str(query(request).type) ?? request.headers['content-type'] ?? '';
      const ext = TIPUS[type.split(';')[0]?.trim() ?? ''];
      if (ext === undefined) {
        throw new PolicyError(
          'unsupported-type',
          'Unsupported image type',
          422,
          `The logo has to be one of ${Object.keys(TIPUS).join(', ')}.`,
        );
      }

      const bytes = request.body as Buffer;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        throw new PolicyError('empty-body', 'Empty body', 422, 'The image is empty.');
      }
      if (bytes.length > MAX_BYTES) {
        throw new PolicyError(
          'too-large',
          'Image too large',
          422,
          `The logo has to be at most ${String(MAX_BYTES / 1024)} KB.`,
        );
      }

      // **Se substitueix, no s'acumula.** Només n'hi pot haver un, i deixar-ne un de cada
      // format faria que el que es veu depengués de l'ordre en què es llegeix el directori.
      const dir = brandDir(app);
      mkdirSync(dir, { recursive: true });
      for (const altra of Object.values(TIPUS)) {
        rmSync(join(dir, `logo.${altra}`), { force: true });
      }
      writeFileSync(join(dir, `logo.${ext}`), bytes);

      return { logo_url: '/brand/logo' };
    }),
  );

  app.delete('/api/v1/admin/branding/logo', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      if (!hasCapability(principal, 'instance:manage')) throw missingCapability('instance:manage');
      const dir = brandDir(app);
      for (const ext of Object.values(TIPUS)) rmSync(join(dir, `logo.${ext}`), { force: true });
      return { logo_url: null };
    }),
  );
}
