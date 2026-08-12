#!/usr/bin/env node
/**
 * agent-skill — el full d'instruccions que serveix l'app no pot divergir de `docs/agent/`.
 *
 * És la mateixa família que `tokens-parity` i `i18n-lint`: hi ha una font —els tres
 * markdown de `docs/agent/skill/`— i un generat que el servidor serveix a Ajustos ▸ Usuari
 * IA. Sense aquesta comprovació, corregir una regla del skill al document deixaria l'app
 * repartint la versió vella **sense que res ho digués**, que és pitjor que no tenir-lo:
 * l'agent es comportaria segons un full que ningú recorda haver escrit.
 */

import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './lib/scan.mjs';

const result = spawnSync(
  process.execPath,
  [join(ROOT, 'tools', 'gen', 'agent-skill.mjs'), '--check'],
  {
    encoding: 'utf8',
  },
);

process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
process.exit(result.status ?? 1);
