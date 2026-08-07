#!/usr/bin/env node
/**
 * no-ignored-sources — comprovació permanent.
 *
 * "Codi font que el repositori no porta."
 *
 * EL DEFECTE QUE EXISTEIX PER ATURAR
 * ----------------------------------
 * `.gitignore` deia `data/` per a les dades locals de desenvolupament. Un patró sense
 * barra al davant coincideix amb **qualsevol** carpeta d'aquell nom a qualsevol
 * profunditat, i n'hi havia una que era codi:
 *
 *     apps/android/core-data/src/main/kotlin/ho/fem/data/
 *
 * O sigui que el mòdul `:core-data` sencer —la base de Room, el repositori, el
 * contenidor i la cua de sortida— **no s'ha pujat mai**. En local tot compilava perquè
 * els fitxers hi eren; qui clonés el repositori tenia una app que no compila. Es va
 * descobrir el dia que CI es va executar per primera vegada, i el símptoma era
 * `Unresolved reference 'Container'` en un mòdul que ningú havia tocat.
 *
 * COM ES COMPROVA
 * ---------------
 * Es demana a git mateix quins fitxers de codi hi ha al disc que ell ignoraria. No es
 * llegeix `.gitignore` ni s'intenta interpretar-ne els patrons: `git check-ignore` és
 * qui mana, i qualsevol regla futura queda coberta sense tocar això.
 *
 * El que compta com a codi són les extensions del projecte dins d'un directori de font
 * (`src/`, `tools/`, `packages/`), no qualsevol fitxer: els generats i les sortides de
 * construcció s'han d'ignorar i seguiran ignorant-se.
 */

import { execFileSync } from 'node:child_process';
import { ROOT } from './lib/scan.mjs';

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.kt', '.kts', '.sql'];

/** Només el que és font. `build/`, `dist/` i `node_modules/` s'han d'ignorar de debò. */
const SOURCE_DIRS = ['apps/', 'packages/', 'tools/'];
const NOT_SOURCE = ['/build/', '/dist/', '/node_modules/', '/generated/', '/.gradle/'];

function isSource(path) {
  if (!EXTENSIONS.some((ext) => path.endsWith(ext))) return false;
  if (!SOURCE_DIRS.some((dir) => path.startsWith(dir))) return false;
  return !NOT_SOURCE.some((part) => path.includes(part));
}

if (process.argv.includes('--self-test')) {
  const cases = [
    ['apps/android/core-data/src/main/kotlin/ho/fem/data/Container.kt', true],
    ['packages/contracts/src/i18n.ts', true],
    ['tools/checks/lib/scan.mjs', true],
    ['apps/server/dist/index.js', false], // sortida de construcció
    ['apps/android/app/build/tmp/X.kt', false], // sortida de construcció
    ['packages/contracts/src/generated/api.ts', false], // generat
    ['apps/web/index.html', false], // no és de les extensions
    ['docs/03-ui-android.md', false], // no és font de codi
  ];

  let bad = 0;
  for (const [path, expected] of cases) {
    if (isSource(path) !== expected) {
      console.error(`  ${path}: esperava ${String(expected)}`);
      bad += 1;
    }
  }
  console.log(`no-ignored-sources --self-test · ${String(cases.length)} casos`);
  if (bad > 0) process.exit(1);
  console.log('  autoprova correcta.');
  process.exit(0);
}

/**
 * `git ls-files --others --ignored` llista el que hi ha al disc i git ignora.
 * `--directory` s'omet a posta: volem els fitxers un per un, no la carpeta collapsada.
 */
const output = execFileSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

const hidden = output.split('\n').filter((line) => line !== '' && isSource(line));

if (hidden.length > 0) {
  console.error(
    `no-ignored-sources · ${String(hidden.length)} fitxers de codi que el repositori NO porta:`,
  );
  for (const path of hidden) console.error(`  ${path}`);
  console.error(
    '\n  Qui cloni el projecte no els tindrà. Mira si el patró de `.gitignore` que els\n' +
      "  agafa hauria d'anar ancorat a l'arrel amb una barra al davant (`/data/`).",
  );
  process.exit(1);
}

console.log('no-ignored-sources · net');
