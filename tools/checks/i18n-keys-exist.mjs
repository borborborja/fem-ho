#!/usr/bin/env node
/**
 * i18n-keys-exist — una clau mal escrita s'ensenya crua a la cara.
 *
 * `t()` torna la clau quan no la troba, i està ben pensat: una pantalla amb
 * `board.column.inbox` escrit a sobre es veu de seguida i es corregeix, i un forat no.
 * Però **fins que algú obre aquella pantalla, res ho diu**: `t('board.colum.inbox')`
 * compila, passa TypeScript, passa ESLint i passa les altres onze comprovacions.
 *
 * Això ho atrapa abans. Es miren totes les crides amb una clau literal —que són la
 * immensa majoria— i es comprova que existeixi al catàleg.
 *
 * **Les crides amb plantilla se salten a posta.** `t(\`activity.verb.${verb}\`)` i
 * `t(\`settings.sources.kind.${kind}\`)` construeixen la clau en temps d'execució i no
 * es poden resoldre aquí sense executar el codi. Es podria exigir que no n'hi hagués
 * cap, però són el patró correcte per a un enum i prohibir-lo faria escriure quinze
 * condicionals per guanyar una comprovació.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, report, walk } from './lib/scan.mjs';

const CATALOG = join(ROOT, 'packages', 'contracts', 'i18n', 'ca.json');

/**
 * Les claus literals d'un text font.
 *
 * `t('a.b')` i `t("a.b")`, amb o sense segon argument. Les plantilles amb `${}` no hi
 * entren perquè el patró exigeix cometes simples o dobles.
 */
export function literalKeys(text) {
  const found = [];
  text.split('\n').forEach((line, index) => {
    // Un exemple dins d'un comentari no és una crida. Els blocs de documentació del
    // codi en porten, i marcar-los faria que la comprovació obligués a no explicar-se.
    if (/^\s*(\/\/|\*|\/\*)/u.test(line)) return;
    for (const match of line.matchAll(/\bt\(\s*(?:'([^'\n]+)'|"([^"\n]+)")/gu)) {
      found.push({ key: match[1] ?? match[2] ?? '', line: index + 1, text: line.trim() });
    }
  });
  return found;
}

export function missing(sources, keys) {
  const problems = [];
  for (const file of sources) {
    for (const use of literalKeys(file.text)) {
      if (keys.has(use.key)) continue;
      problems.push({
        rel: file.rel,
        line: use.line,
        rule: 'clau-inexistent',
        message:
          `La clau "${use.key}" no és al catàleg. A la pantalla s'hi veurà escrita tal ` +
          'com és, i cap prova ho dirà abans.',
        excerpt: use.text,
      });
    }
  }
  return problems;
}

if (process.argv.includes('--self-test')) {
  const keys = new Set(['board.column.inbox']);
  const found = missing(
    [
      { rel: 'x.tsx', text: "const a = t('board.column.inbox');" },
      { rel: 'y.tsx', text: "const b = t('board.colum.inbox');" },
      { rel: 'z.tsx', text: 'const c = t(`activity.verb.${verb}`);' },
      { rel: 'c.tsx', text: " * El client hi posa t('error.<slug>', params) i el pinta." },
      { rel: 'w.tsx', text: "const d = t('board.column.inbox', { count: 2 });" },
    ],
    keys,
  );
  if (found.length !== 1 || found[0].rel !== 'y.tsx') {
    console.error(
      "i18n-keys-exist · autoprova fallida: ha de marcar NOMÉS l'errata, i no la " +
        `plantilla ni la crida amb valors. Ha marcat: ${JSON.stringify(found.map((p) => p.rel))}`,
    );
    process.exit(1);
  }
  console.log('i18n-keys-exist · autoprova correcta');
  process.exit(0);
}

const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
const keys = new Set(Object.keys(catalog).filter((key) => !key.startsWith('$')));

// `walk` és un generador: es materialitza per poder-ne dir quants n'ha mirat.
const sources = [...walk(undefined, ['.tsx', '.ts', '.jsx'])];
const problems = missing(sources, keys);

console.log(
  `i18n-keys-exist · ${String(keys.size)} claus al catàleg, ` +
    `${String(sources.length)} fitxers mirats`,
);
process.exit(report('i18n-keys-exist', problems));
