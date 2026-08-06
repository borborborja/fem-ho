#!/usr/bin/env node
/**
 * css-classes — una classe que no existeix no és un error, i aquest és el problema.
 *
 * `className="femho-input"` i `className="plou-button"` van estar setmanes al codi.
 * TypeScript no en sap res, ESLint tampoc, i les proves de navegador miren
 * `data-testid` i variables CSS calculades, no si una classe té regla. El resultat era
 * que **tots els camps i tots els botons de l'app es veien sense estil** i cap
 * comprovació ho deia: el nom real és `plou-input` i `plou-btn`.
 *
 * Aquí es llegeixen les classes que defineix el design system i es comprova que totes
 * les que el codi fa servir hi siguin. És la mateixa família que `i18n-lint`: un valor
 * escrit a mà que ha de coincidir amb una font de veritat.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, report, walk } from './lib/scan.mjs';

const DESIGN = join(ROOT, 'packages', 'design-system');

/**
 * Tots els `.css` d'un directori.
 *
 * Es llegeixen a mà i no amb `walk`, que exclou `packages/design-system/plou` a posta:
 * Plou és codi vendoritzat i no es lintra. Però **sí que és la font de veritat** de
 * quines classes existeixen, i per això aquí s'hi entra igualment. La diferència és que
 * no se'l jutja, se'l consulta.
 */
function cssFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === 'dist') continue;
    if (statSync(full).isDirectory()) found.push(...cssFiles(full));
    else if (entry.endsWith('.css')) found.push(full);
  }
  return found;
}

function definedClasses() {
  const defined = new Set();
  const files = [...cssFiles(DESIGN), ...cssFiles(join(ROOT, 'apps', 'web', 'src'))];

  for (const file of files) {
    const css = readFileSync(file, 'utf8');
    for (const match of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) defined.add(match[1]);
  }

  return defined;
}

/** Les classes que el codi fa servir, amb on. */
function usedClasses() {
  const used = [];
  const sources = [
    ...walk(join(ROOT, 'apps', 'web', 'src'), ['.tsx', '.ts']),
    ...walk(join(DESIGN, 'femho'), ['.jsx']),
  ];

  for (const file of sources) {
    file.text.split('\n').forEach((line, index) => {
      // `className="a b"` i `className={'a b'}`. Les plantilles amb interpolació se
      // salten: el nom no es pot resoldre sense executar el codi.
      for (const match of line.matchAll(/className=(?:"([^"{}]+)"|\{'([^'{}]+)'\})/g)) {
        const value = match[1] ?? match[2] ?? '';
        for (const name of value.split(/\s+/u).filter((part) => part !== '')) {
          used.push({ name, rel: file.rel, line: index + 1, text: line.trim() });
        }
      }
    });
  }

  return used;
}

const defined = definedClasses();
const problems = [];

for (const use of usedClasses()) {
  if (defined.has(use.name)) continue;
  problems.push({
    rel: use.rel,
    line: use.line,
    rule: 'classe-inexistent',
    message:
      `La classe "${use.name}" no està definida a cap CSS. Els elements que la portin ` +
      'es veuran sense estil i res no fallarà.',
    excerpt: use.text,
  });
}

if (process.argv.includes('--self-test')) {
  // L'autoprova: la comprovació ha de veure una classe inventada.
  const inventada = !defined.has('aquesta-classe-no-existeix-enlloc');
  if (!inventada) {
    console.error('css-classes · autoprova fallida: hauria de faltar la classe inventada');
    process.exit(1);
  }
  console.log(`css-classes · autoprova correcta (${String(defined.size)} classes definides)`);
  process.exit(0);
}

console.log(`css-classes · ${String(defined.size)} classes definides al design system`);
process.exit(report('css-classes', problems));
