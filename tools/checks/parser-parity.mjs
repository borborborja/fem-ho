#!/usr/bin/env node
/**
 * parser-parity — comprovació permanent de docs/13.
 *
 * "Divergència entre el parser de TypeScript i el de Kotlin."
 *
 * docs/03 §1 diu per què existeix: "El parser d'afegida ràpida té els mateixos casos de
 * prova en TypeScript i en Kotlin, verificats a CI. **Sense això, les dues
 * implementacions divergeixen i ningú se n'adona fins que un usuari escriu
 * `#Feina/Client Salt` amb un espai.**"
 *
 * QUÈ COMPROVA, I PER QUÈ AIXÍ
 * -----------------------------
 * La paritat de veritat la donen les proves de cada costat executant EL MATEIX fitxer de
 * casos. El que aquesta comprovació vigila és que això segueixi sent cert:
 *
 *   1. Els fixtures existeixen i tenen casos.
 *   2. Les proves de TypeScript els llegeixen del fitxer i **no en tenen d'escrits a
 *      dins**. Un cas escrit a la prova de TS és un cas que Kotlin no veurà mai, i és
 *      exactament així com comença la divergència.
 *   3. Quan Android existeixi (M13), que les seves proves també els llegeixin.
 *
 * Mentre no hi hagi Kotlin, ho diu clarament en comptes de passar en verd.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { ROOT } from './lib/scan.mjs';

const FIXTURES = join(ROOT, 'packages', 'contracts', 'fixtures', 'quickadd.json');
const TS_TEST = join(ROOT, 'packages', 'contracts', 'src', 'quickadd.test.ts');
const ANDROID = join(ROOT, 'apps', 'android');

const problems = [];
const notes = [];

if (!existsSync(FIXTURES)) {
  console.error(`parser-parity · no hi ha fixtures a ${FIXTURES}`);
  process.exit(1);
}

const fixtures = JSON.parse(readFileSync(FIXTURES, 'utf8'));
const caseCount = (fixtures.cases?.length ?? 0) + (fixtures.singleActiveScope?.cases?.length ?? 0);

if (caseCount === 0) {
  problems.push('Els fixtures no tenen cap cas.');
}

// El cas concret que docs/03 §1 anomena. Si desapareix, la comprovació perd el sentit.
const inputs = [...(fixtures.cases ?? []), ...(fixtures.singleActiveScope?.cases ?? [])].map(
  (c) => c.input ?? '',
);

if (!inputs.some((input) => input.includes('/') && /\/\S+ \S/.test(input))) {
  problems.push(
    "Falta el cas d'un projecte amb un espai al nom (#Àmbit/Nom Amb Espai). És el que " +
      "docs/03 §1 diu que ningú detecta fins que passa a casa d'algú.",
  );
}

if (!existsSync(TS_TEST)) {
  problems.push(`No hi ha proves de TypeScript a ${TS_TEST}.`);
} else {
  const source = readFileSync(TS_TEST, 'utf8');

  // Es busca una IMPORTACIÓ, no la cadena: el nom del fitxer surt també al comentari
  // de capçalera, i comprovar la cadena feia que una menció en prosa satisfés el check.
  // Ho va destapar provar que la comprovació fallés de veritat.
  const importsFixtures = /^\s*import\s+\w+\s+from\s+['"][^'"]*fixtures\/quickadd\.json['"]/m.test(
    source,
  );
  if (!importsFixtures) {
    problems.push(
      'Les proves de TypeScript no IMPORTEN fixtures/quickadd.json. Si els casos són ' +
        'a la prova, Kotlin no els veurà mai.',
    );
  }

  // Un `it(...)` amb una cadena d'entrada escrita a dins, fora dels blocs `it.each`, és
  // un cas que només existeix en un dels dos costats.
  const inlineCases = [...source.matchAll(/parseQuickAdd\(\s*'([^']{12,})'/g)]
    .map((m) => m[1])
    .filter((input) => !inputs.includes(input));

  if (inlineCases.length > 0) {
    notes.push(
      `${inlineCases.length} entrades escrites a la prova de TS i no als fixtures. ` +
        'Valen com a proves del costat de TS, però Kotlin no les executarà: ' +
        `${inlineCases
          .slice(0, 3)
          .map((i) => JSON.stringify(i))
          .join(', ')}`,
    );
  }
}

/**
 * El costat de Kotlin, amb **el mateix llistó que el de TypeScript**.
 *
 * Comprovar només que `apps/android` existeixi seria una comprovació de mentida: el que
 * importa no és que hi hagi codi Kotlin, sinó que les seves proves llegeixin **aquest**
 * fitxer de casos. Una prova de Kotlin amb els casos escrits a dins passaria igual i la
 * divergència tornaria a ser invisible.
 */
const androidExists = existsSync(ANDROID);

if (androidExists) {
  const kotlinTests = findKotlinTests(ANDROID);

  if (kotlinTests.length === 0) {
    problems.push(
      `Hi ha ${ANDROID} però cap prova de Kotlin que parli del parser. Els fixtures ` +
        'només els executa un dels dos costats.',
    );
  } else {
    const readsFixtures = kotlinTests.some((file) =>
      /packages\/contracts\/fixtures\/quickadd\.json/.test(readFileSync(file, 'utf8')),
    );

    if (!readsFixtures) {
      problems.push(
        'Cap prova de Kotlin llegeix packages/contracts/fixtures/quickadd.json. Si els ' +
          'casos són a la prova, TypeScript i Kotlin no proven el mateix.',
      );
    }

    // Els mateixos casos escrits a mà al costat de Kotlin: valen com a proves seves,
    // però no són paritat.
    const inlineKotlin = kotlinTests.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/parseQuickAdd\(\s*"([^"]{12,})"/g)]
        .map((m) => m[1])
        .filter((input) => !inputs.includes(input)),
    );

    if (inlineKotlin.length > 0) {
      notes.push(
        `${inlineKotlin.length} entrades escrites a les proves de Kotlin i no als ` +
          'fixtures. TypeScript no les executarà.',
      );
    }
  }
}

/** Els fitxers de prova de Kotlin que toquen el parser. */
function findKotlinTests(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'build' || entry.name === '.gradle') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        entry.name.endsWith('.kt') &&
        /parseQuickAdd|QuickAdd/.test(readFileSync(full, 'utf8'))
      ) {
        if (full.includes(`${sep}test${sep}`)) found.push(full);
      }
    }
  };
  walk(root);
  return found;
}

console.log(`parser-parity · ${caseCount} casos compartits als fixtures`);
for (const note of notes) console.warn(`  nota: ${note}`);

if (problems.length > 0) {
  console.error(`\n${problems.length} problemes de paritat:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

if (!androidExists) {
  console.log(
    "  el costat de TypeScript els executa. El de Kotlin s'hi afegirà a M13, quan hi " +
      'hagi apps/android.',
  );
} else {
  console.log('  els dos costats executen els mateixos casos.');
}
