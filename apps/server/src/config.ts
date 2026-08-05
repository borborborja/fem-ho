/**
 * Configuració per variables d'entorn amb prefix FEMHO_ (docs/12 §3).
 *
 * Els secrets accepten el sufix _FILE per llegir-los d'un fitxer, que és el que permet
 * fer servir secrets de Docker. A M1 encara no hi ha cap secret, però el lector ja hi
 * és perquè no s'hagi de reescriure la lectura més endavant.
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

function envRegistration(): RegistrationMode {
  const raw = env('REGISTRATION') ?? 'disabled';
  if (!(REGISTRATION_MODES as readonly string[]).includes(raw)) {
    throw new Error(
      `FEMHO_REGISTRATION ha de ser un de ${REGISTRATION_MODES.join(', ')}, i és "${raw}"`,
    );
  }
  return raw as RegistrationMode;
}

export interface Config {
  /** Nom de la instància, el que veu qui s'hi connecta. */
  instanceName: string;
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
  /** Cadena de connexió. Per defecte SQLite a /data, que és el cas recomanat (D11). */
  databaseUrl: string;
  registration: RegistrationMode;
  logLevel: string;
}

export function loadConfig(version: string): Config {
  return {
    instanceName: env('INSTANCE_NAME') ?? 'Fem-ho',
    version,
    baseUrl: env('BASE_URL'),
    port: envInt('PORT', 8080),
    davPort: envInt('DAV_PORT', 8081),
    dataDir: env('DATA_DIR') ?? '/data',
    databaseUrl: env('DATABASE_URL') ?? 'sqlite:///data/femho.db',
    registration: envRegistration(),
    logLevel: env('LOG_LEVEL') ?? 'info',
  };
}
