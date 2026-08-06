#!/usr/bin/env node
/**
 * tokens-parity — el Kotlin de Compose no pot divergir del CSS de Plou.
 *
 * D7: **una direcció i prou.** El CSS és la font de veritat i `Tokens.kt` en surt. Sense
 * aquesta comprovació, afegir un token a Plou —o canviar-ne el valor— deixaria Android
 * pintant el color vell, i ningú se n'assabentaria fins que algú posés les dues
 * pantalles de costat.
 *
 * És la mateixa família de comprovació que `i18n-lint` fa amb `strings.xml`: hi ha un
 * generat, i el generat ha d'estar al dia.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './lib/scan.mjs';

const ANDROID = join(ROOT, 'apps', 'android');

if (!existsSync(ANDROID)) {
  console.log('tokens-parity · encara no hi ha apps/android; res a comprovar');
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  [join(ROOT, 'tools', 'gen', 'tokens-compose.mjs'), '--check'],
  { encoding: 'utf8' },
);

process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
process.exit(result.status ?? 1);
