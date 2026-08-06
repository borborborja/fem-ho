#!/usr/bin/env node
/**
 * i18n-lint — comprovació permanent de docs/13.
 *
 * "Cadenes catalanes al codi en comptes del catàleg."
 *
 * Regla 3: la interfície és en català, sempre via fitxers de traducció, mai literals
 * al codi. El mateix catàleg alimenta la web i el strings.xml d'Android (docs/03 §1);
 * un literal escrit a la web és una divergència garantida amb Android.
 *
 * Es marquen les cadenes de la INTERFÍCIE, no els comentaris ni els missatges de log
 * del servidor, que no els llegeix cap usuari final.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildStringsXml } from '../i18n/strings-xml.mjs';
import { ROOT, applyRules, report, walk } from './lib/scan.mjs';

// Caràcters que només apareixen en català (i altres llengües romàniques), mai en
// identificadors ni en anglès.
const CATALAN = 'àèéíòóúïüçÀÈÉÍÒÓÚÏÜÇ·';

const RULES = [
  {
    name: 'literal-catala-a-jsx',
    // Text català directament entre etiquetes JSX.
    re: new RegExp(`>[^<>{}]*[${CATALAN}][^<>{}]*<`),
    message: 'Text català dins de JSX. Ha de sortir del catàleg (packages/contracts/i18n).',
    allow: (line) => /^\s*\*|\/\/|<!--/.test(line),
  },
  {
    name: 'literal-catala-a-prop',
    // Cadenes catalanes assignades a props de text visible.
    re: new RegExp(
      `\\b(label|title|placeholder|aria-label|ariaLabel|alt|children|text|message)\\s*[=:]\\s*['"\`][^'"\`]*[${CATALAN}]`,
    ),
    message: 'Cadena catalana en una prop visible. Ha de sortir del catàleg.',
    allow: (line) => /^\s*\*|\/\//.test(line),
  },
];

if (process.argv.includes('--self-test')) {
  const fixture = [
    'const a = <span>Afegir tasca a la bústia</span>;',
    "const b = <Button label='Cancel·lar' />;",
    'const c = <span>{t("board.add")}</span>;', // no ha de saltar
    "const d = { status: 'done' };", // no ha de saltar
    '// Comentari en català amb accents: això no és interfície', // no ha de saltar
  ].join('\n');
  const found = applyRules(fixture, RULES, 'autoprova');
  const flagged = new Set(found.map((v) => v.line));
  const missing = [1, 2].filter((l) => !flagged.has(l));
  const falsePositives = [3, 4, 5].filter((l) => flagged.has(l));
  console.log(`i18n-lint --self-test · ${found.length} infraccions`);
  for (const l of missing) console.error(`  NO detecta la línia ${l}`);
  for (const l of falsePositives) console.error(`  FALS POSITIU a la línia ${l}`);
  if (missing.length > 0 || falsePositives.length > 0) process.exit(1);
  console.log('  autoprova correcta.');
  process.exit(0);
}

const violations = [];
for (const file of walk(undefined, ['.tsx', '.jsx', '.kt'])) {
  violations.push(...applyRules(file.text, RULES, file.rel));
}

/**
 * I la segona meitat de la regla: **el `strings.xml` d'Android ha d'estar al dia**.
 *
 * `docs/03` §1 diu que les cadenes catalanes surten del *mateix* catàleg. Comprovar
 * només que no n'hi hagi cap escrita al codi deixa passar el cas invers: algú canvia el
 * catàleg, no regenera, i Android segueix ensenyant el text vell. Cap literal, però
 * tampoc cap desincronització.
 */
const androidStrings = join(
  ROOT,
  'apps',
  'android',
  'app',
  'src',
  'main',
  'res',
  'values',
  'strings.xml',
);
if (existsSync(join(ROOT, 'apps', 'android'))) {
  const catalog = JSON.parse(
    readFileSync(join(ROOT, 'packages', 'contracts', 'i18n', 'ca.json'), 'utf8'),
  );
  const expected = buildStringsXml(catalog);

  if (!existsSync(androidStrings)) {
    violations.push({
      rel: 'apps/android/app/src/main/res/values/strings.xml',
      line: 0,
      rule: 'strings-xml-absent',
      message: 'Hi ha Android però cap strings.xml. Executa `node tools/i18n/strings-xml.mjs`.',
      excerpt: 'El catàleg és la font de veritat i el XML en surt.',
    });
  } else if (readFileSync(androidStrings, 'utf8') !== expected) {
    violations.push({
      rel: 'apps/android/app/src/main/res/values/strings.xml',
      line: 0,
      rule: 'strings-xml-desactualitzat',
      message:
        'El strings.xml no coincideix amb el catàleg: Android ensenyaria el text vell. ' +
        'Executa `node tools/i18n/strings-xml.mjs` i compromet el resultat.',
      excerpt: 'docs/03 §1: les cadenes surten del MATEIX catàleg que la web.',
    });
  }
}

process.exit(report('i18n-lint', violations));
