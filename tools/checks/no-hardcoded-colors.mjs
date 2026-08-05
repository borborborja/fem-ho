#!/usr/bin/env node
/**
 * no-hardcoded-colors — comprovació permanent de docs/13.
 *
 * "Literals de color fora dels tokens."
 *
 * docs/04 §2: cap valor de color, radi, espaiat, ombra o durada s'escriu literal
 * enlloc. El bug del prototip que --column-bg existeix per arreglar era exactament
 * això: un rgba() literal que en tema fosc quedava invisible.
 *
 * L'única font legítima de literals de color és packages/design-system/plou/tokens/,
 * que ja està exclosa del recorregut.
 */

import { applyRules, report, walk } from './lib/scan.mjs';

/**
 * Un comentari no és codi. Cobreix les quatre formes que es donen al projecte:
 * `//`, `/* …`, `{/* …` de JSX, i la continuació ` * …` d'un bloc.
 */
function isComment(line) {
  return /^\s*\*|\/\/|\{?\/\*|<!--/.test(line);
}

const RULES = [
  {
    name: 'hex-literal',
    re: /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/,
    message: 'Color hexadecimal literal. Fes servir un token: var(--…).',
    allow: (line) =>
      // Àncores i identificadors de fragment no són colors.
      /#[0-9a-fA-F]*[g-zG-Z]/.test(line) ||
      /\bhref=|\bid=|url\(#|xlink/.test(line) ||
      isComment(line),
  },
  {
    name: 'rgb-literal',
    re: /\brgba?\(\s*\d/,
    message: 'Color rgb()/rgba() literal. Fes servir un token: var(--…).',
    allow: (line) => isComment(line),
  },
  {
    name: 'hsl-literal',
    re: /\bhsla?\(\s*\d/,
    message: 'Color hsl()/hsla() literal. Fes servir un token: var(--…).',
    allow: (line) => isComment(line),
  },
];

if (process.argv.includes('--self-test')) {
  const fixture = [
    "const bad1 = { color: '#ff0000' };",
    "const bad2 = { background: 'rgba(20,22,30,0.02)' };",
    "const bad3 = { border: '1px solid hsl(210, 50%, 50%)' };",
    "const ok1 = { color: 'var(--ink)' };", // no ha de saltar
    "const ok2 = <a href='#seccio'>x</a>;", // no ha de saltar
    '// vegeu #14161e a la documentació', // no ha de saltar (comentari)
  ].join('\n');
  const found = applyRules(fixture, RULES, 'autoprova');
  const flagged = new Set(found.map((v) => v.line));
  const missing = [1, 2, 3].filter((l) => !flagged.has(l));
  const falsePositives = [4, 5, 6].filter((l) => flagged.has(l));
  console.log(`no-hardcoded-colors --self-test · ${found.length} infraccions`);
  for (const l of missing) console.error(`  NO detecta la línia ${l}`);
  for (const l of falsePositives) console.error(`  FALS POSITIU a la línia ${l}`);
  if (missing.length > 0 || falsePositives.length > 0) process.exit(1);
  console.log('  autoprova correcta.');
  process.exit(0);
}

const violations = [];
for (const file of walk()) {
  violations.push(...applyRules(file.text, RULES, file.rel));
}
process.exit(report('no-hardcoded-colors', violations));
