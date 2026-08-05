#!/usr/bin/env node
/**
 * openapi-diff — comprovació permanent de docs/13, i la comprovació de la fita M1.
 *
 * "Un endpoint sense contracte."
 *
 * Regla 5 d'instruccions.md: packages/contracts/openapi.yaml és la font de veritat, i
 * els tipus de TypeScript i el client de Kotlin es generen des d'ell. Si algú toca un
 * handler sense actualitzar el contracte, CI ha de fallar (docs/05 §8).
 *
 * Fa tres coses, en aquest ordre:
 *   1. Valida l'especificació en OpenAPI 3.1.
 *   2. Regenera els tipus.
 *   3. Comprova que la regeneració no ha canviat res que no estigui compromès.
 */

import { execFileSync } from 'node:child_process';
import { ROOT } from './lib/scan.mjs';

function run(cmd, args, label) {
  try {
    return execFileSync(cmd, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    console.error(`openapi-diff · ha fallat ${label}:`);
    console.error(error.stdout ?? '');
    console.error(error.stderr ?? '');
    process.exit(1);
  }
}

console.log('openapi-diff · validant openapi.yaml');
run('npm', ['run', '--silent', 'contracts:validate'], "la validació de l'especificació");

console.log('openapi-diff · regenerant els tipus');
run('npm', ['run', '--silent', 'contracts:generate'], 'la generació de tipus');

const GENERATED = 'packages/contracts/src/generated';
const status = run('git', ['status', '--porcelain', '--', GENERATED], 'la comprovació de git');

/**
 * Del `porcelain` només importen dues situacions, i cap de les dues és "hi ha un fitxer
 * a punt de comprometre":
 *
 *   - Segona columna diferent d'espai: el generador acaba de modificar un fitxer que ja
 *     estava seguit. Això SÍ que vol dir que el contracte i els tipus divergien.
 *   - `??`: hi ha sortida generada que ningú segueix.
 *
 * Un `A ` (afegit a l'índex, pendent de comprometre) no és cap divergència: és el flux
 * normal de la primera vegada. A CI, després d'un checkout net, no apareix mai.
 */
const desincronitzat = status
  .split('\n')
  .filter((l) => l.trim() !== '')
  .filter((l) => l.startsWith('??') || l[1] !== ' ');

if (desincronitzat.length > 0) {
  console.error('\nopenapi-diff · el codi generat no coincideix amb el contracte:');
  for (const l of desincronitzat) console.error(`  ${l}`);
  console.error(
    '\nAixò vol dir que openapi.yaml i els tipus generats no van sincronitzats. ' +
      'Executa `npm run contracts:generate` i compromet el resultat.',
  );
  process.exit(1);
}

console.log('openapi-diff · el codi generat coincideix amb el contracte.');
