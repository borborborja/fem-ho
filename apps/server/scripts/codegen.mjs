#!/usr/bin/env node
/**
 * Genera src/db/types.ts des de l'esquema real.
 *
 * El procediment és: base nova i buida en un directori temporal → s'hi apliquen les
 * migracions → kysely-codegen en llegeix l'esquema → s'escriuen els tipus.
 *
 * Es fa així i no escrivint els tipus a mà perquè és l'única manera que no divergeixin
 * mai de les migracions. Si algú afegeix una columna i no torna a generar, el typecheck
 * no ho veurà però `openapi-diff` sí que veurà el fitxer canviat.
 *
 * Es genera des de SQLite, que és el motor per defecte (D11). Les divergències de
 * Postgres estan normalitzades al client (connection.ts), o sigui que els tipus valen
 * per als dos.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..');
const OUT = join(SERVER, 'src', 'db', 'types.ts');

const tmp = mkdtempSync(join(tmpdir(), 'femho-codegen-'));
const dbPath = join(tmp, 'schema.db');

try {
  console.log('codegen · aplicant les migracions a una base nova');
  execFileSync('npx', ['tsx', 'scripts/build-schema-db.ts', dbPath], {
    cwd: SERVER,
    stdio: 'inherit',
  });

  console.log("codegen · llegint l'esquema");
  execFileSync(
    'npx',
    [
      'kysely-codegen',
      '--dialect',
      'better-sqlite3',
      '--url',
      dbPath,
      '--out-file',
      OUT,
      '--camel-case',
      'false',
    ],
    { cwd: SERVER, stdio: 'inherit' },
  );

  console.log(`codegen · escrit a ${OUT}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
