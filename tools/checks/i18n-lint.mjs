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

import { applyRules, report, walk } from './lib/scan.mjs';

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

// A M1 encara no hi ha catàleg ni pantalles de producte: l'única UI és la pàgina de
// prova de tokens, que no és interfície d'usuari. La comprovació ja hi és perquè
// entri en vigor sola quan arribi M5.
const violations = [];
for (const file of walk(undefined, ['.tsx', '.jsx', '.kt'])) {
  violations.push(...applyRules(file.text, RULES, file.rel));
}
process.exit(report('i18n-lint', violations));
