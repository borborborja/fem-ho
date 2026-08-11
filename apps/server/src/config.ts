/**
 * Configuració per variables d'entorn amb prefix FEMHO_ (docs/12 §3).
 *
 * Els secrets accepten el sufix _FILE per llegir-los d'un fitxer, que és el que permet
 * fer servir secrets de Docker.
 */

import { readFileSync } from 'node:fs';

/**
 * Llegeix FEMHO_<name>, o el contingut de FEMHO_<name>_FILE si hi és.
 * El sufix _FILE guanya, perquè és el camí explícit.
 */
function env(name: string): string | undefined {
  const fromFile = process.env[`FEMHO_${name}_FILE`];
  if (fromFile !== undefined && fromFile !== '') {
    return readFileSync(fromFile, 'utf8').trim();
  }
  const direct = process.env[`FEMHO_${name}`];
  return direct !== undefined && direct !== '' ? direct : undefined;
}

function envInt(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`FEMHO_${name} ha de ser un enter, i és "${raw}"`);
  }
  return parsed;
}

const REGISTRATION_MODES = ['disabled', 'invite', 'open'] as const;
export type RegistrationMode = (typeof REGISTRATION_MODES)[number];

/**
 * Qui pot fer-se un compte.
 *
 * Hi ha **dues maneres de dir-ho i una sola veritat**, i val la pena que quedi escrit per
 * què. `FEMHO_REGISTRATION` és de sempre i té tres estats —`disabled`, `invite`, `open`—;
 * `FEMHO_ALLOW_REGISTRATION` és el booleà que fa falta el 99% dels cops: la posa a `true`
 * qui vol que la gent es pugui registrar i prou.
 *
 * El booleà és **una drecera, no una segona opció**: `true` vol dir `open` i `false` vol
 * dir `disabled`. I si algú posa les dues dient coses diferents, **el servidor no arrenca**
 * en comptes de triar-ne una: dues variables que es contradiuen és exactament el cas en què
 * qualsevol tria per defecte deixa una instància oberta que algú creia tancada, o al revés.
 * Fallar aviat i dir-ho és l'única resposta honesta.
 */
function envRegistration(): RegistrationMode {
  const explicit = env('REGISTRATION');
  const shorthand = envAllowRegistration();

  if (explicit !== undefined && !(REGISTRATION_MODES as readonly string[]).includes(explicit)) {
    throw new Error(
      `FEMHO_REGISTRATION ha de ser un de ${REGISTRATION_MODES.join(', ')}, i és "${explicit}"`,
    );
  }

  if (shorthand === undefined) return (explicit as RegistrationMode) ?? 'disabled';

  const wanted: RegistrationMode = shorthand ? 'open' : 'disabled';
  if (explicit !== undefined && explicit !== wanted) {
    throw new Error(
      `FEMHO_ALLOW_REGISTRATION="${String(shorthand)}" vol dir "${wanted}", i FEMHO_REGISTRATION diu ` +
        `"${explicit}". Deixa'n només una: dues variables que es contradiuen deixarien la ` +
        'instància oberta o tancada per accident.',
    );
  }
  return wanted;
}

/**
 * Un booleà d'entorn.
 *
 * **El que no és ni `true` ni `false` es rebutja, no s'endevina.** Amb la regla habitual
 * de "qualsevol cosa que no sigui buit és cert", un `FEMHO_ALLOW_REGISTRATION=nope`
 * deixaria el registre obert de bat a bat.
 */
function envBool(name: string): boolean | undefined {
  const raw = env(name);
  if (raw === undefined) return undefined;

  const value = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'si', 'sí'].includes(value)) return true;
  if (['false', '0', 'no'].includes(value)) return false;

  throw new Error(`FEMHO_${name} ha de ser true o false, i és "${raw}"`);
}

function envAllowRegistration(): boolean | undefined {
  return envBool('ALLOW_REGISTRATION');
}

export interface Config {
  /** Nom de la instància, el que veu qui s'hi connecta. */
  instanceName: string;
  /**
   * On és el codi d'aquesta instància. Es publica a `/info` per l'article 13 de l'AGPL:
   * qui hi accedeix per xarxa té dret al codi de la versió que li està servint.
   */
  sourceUrl: string;
  /** Versió del servidor. Surt del package.json en construir. */
  version: string;
  /**
   * URL pública. Obligatòria en producció: sense això, CalDAV i els enllaços compartits
   * generen URL incorrectes, que és la causa número u de problemes (docs/12 §3).
   */
  baseUrl: string | undefined;
  port: number;
  /** La superfície CalDAV va en un port propi, dins del mateix procés (docs/07 §1). */
  davPort: number;
  dataDir: string;
  /** Mida màxima d'un adjunt, en bytes. `docs/12` §3: `FEMHO_MAX_UPLOAD_MB`, 25 per defecte. */
  maxUploadBytes: number;
  /** Cadena de connexió. Per defecte SQLite a /data, que és el cas recomanat (D11). */
  databaseUrl: string;
  registration: RegistrationMode;
  /**
   * Deixar que els avatars surtin de Gravatar.
   *
   * **Apagat per defecte, i no per prudència genèrica.** Fem-ho és autoallotjat: encendre
   * això vol dir que el servidor de casa comença a preguntar a un tercer —Automattic— per
   * la cara de cadascú. Val la pena tenir-ho, però ha de ser una decisió que algú prengui,
   * no una cosa que passi sola.
   */
  gravatar: boolean;
  /**
   * A quins servidors de correu es pot connectar aquesta instància.
   *
   * **Buida vol dir «a qualsevol de públic»**, no «a cap»: la defensa que sempre hi és no
   * és aquesta llista sinó `isBlockedAddress`, que rebutja tot el que resolgui a una
   * adreça interna. Això és per a qui vulgui acotar-ho encara més —una casa que només fa
   * servir un proveïdor— i és `FEMHO_MAIL_ALLOW_HOSTS`, separada per comes.
   */
  mailAllowHosts: string[];
  /**
   * Preguntar a GitHub si hi ha una versió més nova.
   *
   * **Encès per defecte, a diferència de Gravatar, i la diferència importa.** Allà el que
   * s'envia és el hash del correu de cadascú —una dada de les persones de la casa—; aquí
   * és una petició anònima al llistat de versions, un cop cada sis hores, sense cap dada
   * de ningú. El que hi guanyes és assabentar-te d'una actualització de seguretat, i qui
   * no sap que existeix un avís no el va a buscar.
   *
   * Es pot apagar amb `FEMHO_UPDATE_CHECK=false`, i **s'apaga sola** si `FEMHO_SOURCE_URL`
   * no apunta a GitHub: qui publiqui una versió modificada —cosa que l'AGPL §13 preveu i
   * que aquella variable existeix per permetre— no ha de rebre avisos de la versió d'un
   * altre.
   */
  updateCheck: boolean;
  logLevel: string;
  /**
   * El secret de la instància. Si no es dona, es genera un sol cop al volum de dades
   * (`config/secret.ts`) i **no** a la base: qui es quedi una còpia de la base no ha de
   * poder recalcular cap `token_hmac` (docs/10 §3).
   */
  secret: string | undefined;
}

export function loadConfig(version: string): Config {
  return {
    /**
     * On és el codi d'aquesta instància (AGPL §13).
     *
     * Per defecte, el repositori original. **Qui en publiqui una versió modificada hi
     * ha de posar la seva**: amb aquesta apuntant a l'original, els seus usuaris no
     * podrien arribar al codi que realment els està servint.
     */
    sourceUrl: process.env.FEMHO_SOURCE_URL ?? 'https://github.com/borborborja/fem-ho',
    instanceName: env('INSTANCE_NAME') ?? 'Fem-ho',
    version,
    baseUrl: env('BASE_URL'),
    port: envInt('PORT', 8080),
    davPort: envInt('DAV_PORT', 8081),
    dataDir: env('DATA_DIR') ?? '/data',
    maxUploadBytes: (Number(env('MAX_UPLOAD_MB')) || 25) * 1_048_576,
    databaseUrl: env('DATABASE_URL') ?? 'sqlite:///data/femho.db',
    registration: envRegistration(),
    gravatar: envBool('GRAVATAR') ?? false,
    mailAllowHosts: (env('MAIL_ALLOW_HOSTS') ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host !== ''),
    updateCheck: envBool('UPDATE_CHECK') ?? true,
    secret: env('SECRET'),
    logLevel: env('LOG_LEVEL') ?? 'info',
  };
}
