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
 *
 * ELS RECURSOS D'ANDROID TAMBÉ
 * ----------------------------
 * El recorregut per defecte no porta `.xml`, i durant molt de temps això no importava.
 * Amb els widgets de la pantalla d'inici sí: per sota d'API 31 una cantonada arrodonida
 * només es pot fer amb un `<shape>` drawable, i un drawable no llegeix un token de
 * Kotlin —vol un `@color/…`—. Un `#14161e` escrit allà dins passaria les dotze
 * comprovacions i pintaria un color vell per sempre.
 *
 * S'exclouen dues coses i per motius diferents: els `femho_widget_colors.xml`, perquè
 * són **generats** des dels mateixos tokens i porten la capçalera que ho diu; i la icona
 * del llançador, perquè és identitat de marca i ha de ser la mateixa als dos temes —una
 * icona que canviés amb el tema del sistema no seria la mateixa app a la pantalla
 * d'inici.
 */

import { join } from 'node:path';
import { applyRules, isComment, report, ROOT, walk } from './lib/scan.mjs';

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

/** El generat ho diu a la primera línia útil, i no s'hi pot escriure res a mà. */
const isGenerated = (text) => text.includes("GENERAT · no l'editis a mà");

/** La icona del llançador és marca, no superfície: la mateixa als dos temes. */
const isLauncherIcon = (rel) => /ic_launcher/u.test(rel);

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

  /**
   * El cas que la comprovació existeix per aturar: un `<shape>` d'un widget amb el
   * color escrit a mà. Sense la part d'`.xml`, això passava desapercebut.
   */
  const drawable = [
    '<shape xmlns:android="http://schemas.android.com/apk/res/android">',
    '    <solid android:color="#14161e" />', // ha de saltar
    '    <stroke android:width="1dp" android:color="@color/femho_card_border" />', // no
    '    <!-- el token equivalent és #14161e -->', // no: és comentari
    '</shape>',
  ].join('\n');
  const inXml = new Set(applyRules(drawable, RULES, 'autoprova.xml').map((v) => v.line));
  if (!inXml.has(2)) missing.push('xml:2');
  for (const line of [3, 4]) if (inXml.has(line)) falsePositives.push(`xml:${String(line)}`);

  // I que els generats i la icona quedin fora, o la comprovació es denunciaria sola.
  if (!isGenerated("<!--\n  GENERAT · no l'editis a mà.\n-->")) missing.push('generat');
  if (!isLauncherIcon(join('res', 'drawable', 'ic_launcher_background.xml'))) {
    missing.push('icona');
  }
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

for (const file of walk(join(ROOT, 'apps', 'android'), ['.xml'])) {
  if (isGenerated(file.text) || isLauncherIcon(file.rel)) continue;
  violations.push(...applyRules(file.text, RULES, file.rel));
}

process.exit(report('no-hardcoded-colors', violations));
